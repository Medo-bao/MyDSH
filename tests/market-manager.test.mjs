import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MarketManager, marketReleaseVersion } from "@minke/desktop/main/market-manager.ts";
import { bindMarketManagement } from "@minke/desktop/main/market-ipc.ts";
import { MARKET_INSTALL_CHANNEL } from "@minke/harness-overlay/market-contract.ts";

const release = (version = "1.2.3") => ({ name: "dshmarket", version, repository: { url: "git+https://github.com/dsh-market/dsh-market.git" } });
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "firefly-market-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profilePath = join(home, "profiles", "web", "package.json");
  await mkdir(join(home, "profiles", "web"), { recursive: true });
  const original = { name: "test", dependencies: {}, custom: { untouched: true }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "user-plugin"] } } };
  await writeFile(profilePath, JSON.stringify(original));
  async function installRelease(_home, version) {
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    profile.dependencies.dshmarket = version;
    await writeFile(profilePath, JSON.stringify(profile));
    const directory = join(home, "profiles", "web", "node_modules", "dshmarket");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify(release(version)));
  }
  return { home, profilePath, original, installRelease };
}

test("market metadata refuses other sources and command-shaped versions", () => {
  assert.equal(marketReleaseVersion(release()), "1.2.3");
  for (const value of [null, {}, { ...release(), name: "other" }, release("latest"), release("1.2.3 & calc"),
    { ...release(), repository: { url: "https://github.com/other/repo" } }]) {
    assert.throws(() => marketReleaseVersion(value), /Invalid/);
  }
});

test("checking is read-only; installation pins version and preserves user bundles", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const manager = new MarketManager(f.home, { latestRelease: async () => release(), installRelease: async (...args) => { calls++; await f.installRelease(...args); } });
  assert.equal((await manager.status()).installedVersion, null);
  assert.equal((await manager.check()).updateAvailable, true);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(await readFile(f.profilePath, "utf8")), f.original);
  const result = await manager.install();
  assert.equal(result.installedVersion, "1.2.3");
  assert.equal(result.restartRequired, true);
  assert.equal(result.updateAvailable, false);
  const profile = JSON.parse(await readFile(f.profilePath, "utf8"));
  assert.deepEqual(profile.custom, f.original.custom);
  assert.deepEqual(profile.dsh.profile.bundles, [...f.original.dsh.profile.bundles, "dshmarket"]);
  await manager.install();
  assert.equal(calls, 1, "up-to-date market is not reinstalled");
  const restarted = new MarketManager(f.home, { latestRelease: async () => release(), installRelease: f.installRelease });
  assert.equal((await restarted.status()).installedVersion, "1.2.3");
  assert.equal((await restarted.status()).restartRequired, false);
});

test("failed market mutation restores the existing profile and installation", async (t) => {
  const f = await fixture(t);
  await f.installRelease(f.home, "1.0.0");
  const before = await readFile(f.profilePath, "utf8");
  const manager = new MarketManager(f.home, { latestRelease: async () => release(), installRelease: async (...args) => {
    await f.installRelease(...args); throw new Error("network interrupted");
  } });
  await assert.rejects(manager.install(), /network interrupted/);
  assert.equal(await readFile(f.profilePath, "utf8"), before);
  assert.equal((await manager.status()).installedVersion, "1.0.0");
  assert.equal((await manager.status()).restartRequired, false);
});

test("market update replaces an older version without duplicating its bundle or downgrading", async (t) => {
  const f = await fixture(t);
  await f.installRelease(f.home, "1.0.0");
  const profile = JSON.parse(await readFile(f.profilePath, "utf8"));
  profile.dsh.profile.bundles.push("dshmarket");
  await writeFile(f.profilePath, JSON.stringify(profile));
  const manager = new MarketManager(f.home, { latestRelease: async () => release(), installRelease: f.installRelease });
  assert.equal((await manager.check()).updateAvailable, true);
  assert.equal((await manager.install()).installedVersion, "1.2.3");
  assert.equal(JSON.parse(await readFile(f.profilePath, "utf8")).dsh.profile.bundles.filter((name) => name === "dshmarket").length, 1);
  const older = new MarketManager(f.home, { latestRelease: async () => release("1.0.0"), installRelease: () => assert.fail("must not downgrade") });
  assert.equal((await older.install()).installedVersion, "1.2.3");
});

test("registry errors and concurrent installs cannot start a second mutation", async (t) => {
  const f = await fixture(t);
  let releaseCheck;
  const manager = new MarketManager(f.home, { latestRelease: () => new Promise((resolve) => { releaseCheck = resolve; }), installRelease: f.installRelease });
  const first = manager.install();
  let idle = false;
  const finished = manager.whenIdle().then(() => { idle = true; });
  assert.equal(manager.installing, true);
  await assert.rejects(manager.install(), /already running/);
  assert.equal(idle, false);
  releaseCheck(release());
  await first;
  await finished;
  assert.equal(idle, true);
  assert.equal(manager.installing, false);
  const broken = new MarketManager(f.home, { latestRelease: async () => { throw new Error("offline"); }, installRelease: () => assert.fail("must not install") });
  await assert.rejects(broken.install(), /offline/);
  assert.equal((await broken.status()).installedVersion, "1.2.3");
});

test("market IPC authorizes the caller, rejects payloads and disposes", async () => {
  const handlers = new Map();
  let installs = 0;
  const ipc = { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) };
  const binding = bindMarketManagement(ipc, { install: async () => { installs++; } }, (event) => event.trusted, () => {});
  const install = handlers.get(MARKET_INSTALL_CHANNEL);
  assert.throws(() => install({ trusted: false }), /Unauthorized/);
  assert.throws(() => install({ trusted: true }, "arbitrary-package"), /Unauthorized/);
  await install({ trusted: true });
  assert.equal(installs, 1);
  binding.dispose();
  assert.equal(handlers.size, 0);
});
