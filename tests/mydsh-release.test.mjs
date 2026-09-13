import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repairLegacyProfileManifest } from "@minke/desktop/main/system-plugin-installer.ts";
import { configuredClientUpdateSources } from "@minke/desktop/main/client-updater.ts";

test("legacy library registrations are removed without changing user plugins or settings", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "mydsh-migration-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, "profiles", "web");
  await mkdir(profile, { recursive: true });
  const path = join(profile, "package.json");
  const manifest = { dependencies: { react: "^19.2.8", zod: "3.0.0", "@deepseek-ai/schemastery": "^3.18.1", dshmarket: "1.46.1", "user-plugin": "2.0.0" }, dsh: { profile: { bundles: ["dshmarket"] } } };
  await writeFile(path, JSON.stringify(manifest));
  await repairLegacyProfileManifest(home);
  const repaired = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(repaired.dependencies, { dshmarket: "1.46.1", "user-plugin": "2.0.0" });
  assert.deepEqual(repaired.dsh, manifest.dsh);
  await repairLegacyProfileManifest(home);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), repaired);
  repaired.dependencies.react = "^20.0.0";
  await writeFile(path, JSON.stringify(repaired));
  await repairLegacyProfileManifest(home);
  assert.equal(JSON.parse(await readFile(path, "utf8")).dependencies.react, "^20.0.0");
});

test("MyDSH uses its own releases and never checks upstream runtime updates", async () => {
  assert.equal(configuredClientUpdateSources({})[0].apiUrl, "https://api.github.com/repos/Medo-bao/MyDSH/releases/latest");
  const main = await readFile(new URL("../desktop/main/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(main, /DshUpdater|checkDshUpdate|tray\.updateDsh/u);
  assert.match(main, /checkClientUpdate/u);
  const contract = JSON.parse(await readFile(new URL("../config/harness-runtime.json", import.meta.url), "utf8"));
  const overlay = JSON.parse(await readFile(new URL("../packages/harness-overlay/package.json", import.meta.url), "utf8"));
  for (const [name, version] of Object.entries(overlay.dependencies)) {
    if (name.startsWith("@deepseek-ai/dsh-")) assert.equal(version, contract.packageVersion);
  }
});
