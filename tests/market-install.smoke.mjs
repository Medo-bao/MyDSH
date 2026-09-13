import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MarketManager } from "@minke/desktop/main/market-manager.ts";

const home = await mkdtemp(join(tmpdir(), "firefly-market-smoke-"));
try {
  const profile = join(home, "profiles", "web");
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "package.json"), JSON.stringify({ name: "market-smoke", private: true,
    dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }));
  const manager = new MarketManager(home);
  if (process.argv.includes("--exercise-update")) {
    const previous = new MarketManager(home, {
      latestRelease: async () => {
        const response = await fetch("https://registry.npmjs.org/dshmarket/1.45.1", { signal: AbortSignal.timeout(15_000) });
        assert.equal(response.ok, true);
        return response.json();
      },
      installRelease: manager.dependencies.installRelease,
    });
    assert.equal((await previous.install()).installedVersion, "1.45.1");
  }
  const checked = await manager.check();
  assert.equal(checked.installedVersion, process.argv.includes("--exercise-update") ? "1.45.1" : null);
  const installed = await manager.install();
  assert.equal(installed.installedVersion, installed.latestVersion);
  assert.equal(installed.restartRequired, true);
  const manifest = JSON.parse(await readFile(join(profile, "package.json"), "utf8"));
  assert.equal(manifest.dependencies.dshmarket, installed.latestVersion);
  assert.ok(manifest.dsh.profile.bundles.includes("dshmarket"));
  await access(join(profile, "node_modules", "dshmarket", "client", "client.js"));
  const restarted = new MarketManager(home);
  assert.equal((await restarted.status()).installedVersion, installed.latestVersion);
  assert.equal((await restarted.check()).updateAvailable, false);
  console.log(`Market ${installed.installedVersion}: official npm installation, client artifact, bundle registration and restart persistence passed in an isolated profile.`);
} finally {
  await rm(home, { recursive: true, force: true });
}
