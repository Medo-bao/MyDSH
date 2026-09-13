import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pluginInstallTransaction } from "../desktop/main/plugin-install-transaction.ts";
import { verifyHarnessIdentity, verifyHarnessWebBoot } from "../desktop/main/harness-runtime.ts";
import { reconcileOwnedBundles } from "../desktop/main/system-plugin-installer.ts";

test("Windows package junctions and stale links survive snapshot rollback without symlink privilege", { skip: process.platform !== "win32" }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), "firefly-junction-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, "profiles", "web");
  const modules = join(profile, "node_modules");
  const dependency = join(modules, ".store", "dependency");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(dependency, "index.js"), "before");
  await symlink(dependency, join(modules, "dependency"), "junction");
  const missing = join(home, "removed-install", "plugin");
  await symlink(missing, join(modules, "stale-plugin"), "junction");
  const transaction = await pluginInstallTransaction(home, join(home, "state.json"));
  await assert.rejects(transaction(async () => {
    await writeFile(join(dependency, "index.js"), "after");
    throw new Error("rollback");
  }), /rollback/);
  assert.equal(await readFile(join(modules, "dependency", "index.js"), "utf8"), "before");
  assert.equal(await readlink(join(modules, "stale-plugin")), missing);
});

test("identity rejects an impostor and boot requires the root cookie exchange", async (t) => {
  const secret = "a".repeat(64);
  let forged = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/firefly-desktop-identity") {
      const proof = createHmac("sha256", forged ? "wrong" : secret).update(`${url.host}\n${url.searchParams.get("challenge")}`).digest("hex");
      res.end(JSON.stringify({ proof }));
    } else if (url.searchParams.has("token")) {
      res.writeHead(303, { location: "/", "set-cookie": "dsh-auth=valid; HttpOnly" }); res.end();
    } else if (req.headers.cookie === "dsh-auth=valid") {
      res.end('<script>globalThis["__DSH_BOOT__"] = {"entries":[{"id":"@firefly-harness/bundle-companion"}]}</script>');
    } else { res.writeHead(401); res.end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => { server.closeAllConnections(); return new Promise((done) => server.close(done)); });
  const url = `http://127.0.0.1:${server.address().port}/?token=test`;
  await verifyHarnessIdentity(url, secret);
  await verifyHarnessWebBoot(url);
  forged = true;
  await assert.rejects(verifyHarnessIdentity(url, secret), /identity verification failed/);
  await assert.rejects(verifyHarnessWebBoot(new URL(url).origin), /HTTP 401/);
});

test("Windows path aliases preserve transaction ownership and internal snapshot links", { skip: process.platform !== "win32" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mydsh-alias-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, "ActualHome");
  const alias = join(directory, "AliasHome");
  const profile = join(home, "profiles", "web");
  await mkdir(join(profile, "store"), { recursive: true });
  await symlink(home, alias, "junction");
  await writeFile(join(profile, "store", "value"), "before");
  await symlink(join(alias, "profiles", "web", "store"), join(profile, "dependency"), "junction");
  const state = join(alias.toUpperCase(), "state.json");
  const transaction = await pluginInstallTransaction(home, state);
  await assert.rejects(transaction(async () => {
    await writeFile(join(profile, "dependency", "value"), "after");
    throw new Error("rollback alias");
  }), /rollback alias/u);
  assert.equal(await readFile(join(profile, "dependency", "value"), "utf8"), "before");
  await assert.rejects(pluginInstallTransaction(home, join(directory, "state.json")), /directly inside/u);
  await assert.rejects(pluginInstallTransaction(home, join(profile, "state.json")), /directly inside/u);
});

test("failed plugin install restores profile, package tree and state", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "firefly-transaction-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const state = join(home, "state.json");
  const profile = join(home, "profiles", "web");
  await mkdir(profile, { recursive: true });
  await mkdir(join(home, "firefly-plugins"));
  await writeFile(join(profile, "config.json"), "original");
  await writeFile(state, "old");
  const transaction = await pluginInstallTransaction(home, state);
  await assert.rejects(transaction(async () => {
    await writeFile(join(profile, "config.json"), "broken");
    await writeFile(join(home, "firefly-plugins", "partial"), "partial");
    await writeFile(state, "new");
    throw new Error("install failed");
  }), /install failed/);
  assert.equal(await readFile(join(profile, "config.json"), "utf8"), "original");
  assert.equal(await readFile(state, "utf8"), "old");
  await assert.rejects(readFile(join(home, "firefly-plugins", "partial")), { code: "ENOENT" });
  await transaction(async () => writeFile(state, "committed"));
  assert.equal(await readFile(state, "utf8"), "committed");
});

test("startup recovers interrupted plugin installation before another install", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "firefly-recovery-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const recovery = join(home, ".firefly-plugin-recovery");
  await mkdir(recovery);
  await writeFile(join(recovery, "journal.json"), JSON.stringify({ phase: "ready", existed: [false, false, true] }));
  await writeFile(join(recovery, "2"), "before");
  await writeFile(join(home, "state.json"), "partial");
  await pluginInstallTransaction(home, join(home, "state.json"));
  assert.equal(await readFile(join(home, "state.json"), "utf8"), "before");
  await assert.rejects(readFile(join(recovery, "journal.json")), { code: "ENOENT" });
});

test("journal-less remnants cannot contaminate the next rollback", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "firefly-orphan-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const backup = join(home, ".firefly-plugin-recovery", "0");
  const profile = join(home, "profiles", "web");
  await mkdir(backup, { recursive: true });
  await mkdir(profile, { recursive: true });
  await writeFile(join(backup, "obsolete.js"), "retired");
  await writeFile(join(profile, "current.js"), "active");
  const transaction = await pluginInstallTransaction(home, join(home, "state.json"));
  await assert.rejects(transaction(async () => { throw new Error("failed"); }), /failed/);
  assert.equal(await readFile(join(profile, "current.js"), "utf8"), "active");
  await assert.rejects(readFile(join(profile, "obsolete.js")), { code: "ENOENT" });
});

test("retired plugin bundles are removed without changing user bundles or settings", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "firefly-retired-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, "profiles", "web");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "package.json");
  await writeFile(path, JSON.stringify({ custom: { enabled: true }, dsh: { profile: {
    bundles: ["@deepseek-ai/dsh-base", "dsh-session-manager", "@deepseek-ai/dsh-third-party-thinking", "@deepseek-ai/dsh-file-changes", "@deepseek-ai/dsh-client-file-changes", "@deepseek-ai/dsh-balance", "@deepseek-ai/dsh-prompt-custom", "@deepseek-ai/dsh-conversation-tweaks", "@dsh-external/dsh-vision", "@dsh-external/dsh-side-session", "@vlln/dsh-navbar", "dshmarket", "user-plugin"],
  } } }));
  await reconcileOwnedBundles(home, []);
  const value = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(value.dsh.profile.bundles, ["@deepseek-ai/dsh-base", "dshmarket", "user-plugin"]);
  assert.deepEqual(value.custom, { enabled: true });
});
