import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { MinkeConfigStore } from "@minke/desktop/main/minke-config.ts";
import { adaptMarketRestart } from "@minke/desktop/main/market-restart-adapter.ts";
import { bindMarketManagement } from "@minke/desktop/main/market-ipc.ts";
import { CLOSE_BEHAVIOR_CHANNEL } from "@minke/harness-overlay/window-control-contract.ts";

test("close behavior defaults to tray and persists explicit quit without clobbering other settings", async () => {
  const home = await mkdtemp(join(tmpdir(), "mydsh-close-"));
  try {
    const store = new MinkeConfigStore(home);
    assert.equal(await store.closeBehavior.read(), "tray");
    await Promise.all([store.closeBehavior.write("quit"), store.shortcuts.write({ "session.new": "Mod+N" })]);
    const reopened = new MinkeConfigStore(home);
    assert.equal(await reopened.closeBehavior.read(), "quit");
    assert.equal((await reopened.shortcuts.read())["session.new"], "Mod+N");
    await assert.rejects(store.closeBehavior.write("hide"), /Invalid close behavior/);
    assert.equal(await store.closeBehavior.read(), "quit");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("market restart adapter delegates to IPC only under desktop ownership and is idempotent", async () => {
  const home = await mkdtemp(join(tmpdir(), "mydsh-restart-"));
  try {
    await adaptMarketRestart(home);
    const file = join(home, "profiles/web/node_modules/dshmarket/lib/restart.js");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "export function scheduleRestart(port = null) { return 'original'; }");
    await adaptMarketRestart(home);
    const source = await readFile(file, "utf8");
    await adaptMarketRestart(home);
    assert.equal(await readFile(file, "utf8"), source);
    const messages = [];
    const process = { env: { MYDSH_MANAGED_RESTART: "1" }, connected: true, send: m => messages.push(m), pid: 20, ppid: 10 };
    const evaluate = () => runInNewContext(`${source.replace("export ", "")} scheduleRestart()`, { process });
    assert.equal(evaluate().helperPid, 10);
    assert.equal(messages[0].type, "mydsh:restart");
    process.connected = false;
    assert.equal(evaluate(), "original");
    await writeFile(file, "export function newRestartApi() {}");
    await assert.rejects(adaptMarketRestart(home), /incompatible/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("close behavior IPC validates caller and exact payload", async () => {
  const handlers = new Map();
  const saved = [];
  const binding = bindMarketManagement({ handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) },
    {}, event => event.trusted === true, () => {}, { info: async () => ({}), update: async () => {}, setCloseBehavior: async value => saved.push(value) });
  const write = handlers.get(CLOSE_BEHAVIOR_CHANNEL);
  assert.throws(() => write({}, "quit"), /Unauthorized/);
  assert.throws(() => write({ trusted: true }, "tray", "extra"), /Unauthorized/);
  assert.throws(() => write({ trusted: true }, { behavior: "quit" }), /Invalid/);
  await write({ trusted: true }, "tray");
  assert.deepEqual(saved, ["tray"]);
  binding.dispose();
  assert.equal(handlers.size, 0);
});
