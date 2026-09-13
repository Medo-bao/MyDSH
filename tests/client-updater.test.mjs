import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ClientUpdater } from "@minke/desktop/main/client-updater.ts";

async function fixture(t, badChecksum = false) {
  const root = await mkdtemp(join(tmpdir(), "mydsh-update-test-"));
  const payload = Buffer.alloc(4096, 7);
  const server = createServer((request, response) => {
    if (request.url === "/checksum") {
      response.end(`${badChecksum ? "0".repeat(64) : createHash("sha256").update(payload).digest("hex")}  MyDSH-Setup.exe`);
    } else {
      response.writeHead(200, { "content-length": payload.length });
      response.write(payload.subarray(0, 2048));
      const timer = setTimeout(() => response.end(payload.subarray(2048)), 80);
      response.once("close", () => clearTimeout(timer));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const updater = new ClientUpdater({ currentVersion: "0.0.2", updatesRoot: root, sources: [] });
  const update = { version: "0.0.3", source: { name: "GitHub", apiUrl: url }, installerName: "MyDSH-Setup.exe", installerUrl: url, checksumUrl: `${url}/checksum`, mirrors: [] };
  return { root, updater, update, payload };
}

test("desktop download reports byte progress and verifies checksum", async t => {
  const { updater, update, payload } = await fixture(t);
  const progress = [];
  const file = await updater.download(update, { progress: (...state) => progress.push(state) });
  assert.deepEqual(await readFile(file), payload);
  assert.ok(progress.some(([phase, percent]) => phase === "downloading" && percent === 50));
  assert.ok(progress.some(([phase, percent]) => phase === "downloading" && percent === 100));
  assert.equal(progress.at(-1)[0], "verifying");
});

test("cancelling download removes partial data and does not try mirrors", async t => {
  const { root, updater, update } = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(updater.download(update, { signal: controller.signal, progress: (_phase, percent) => { if (percent > 0) controller.abort(); } }), { name: "AbortError" });
  assert.deepEqual(await readdir(root), []);
});

test("checksum failure never leaves a launchable installer", async t => {
  const { root, updater, update } = await fixture(t, true);
  await assert.rejects(updater.download(update), /downloads failed/);
  assert.deepEqual(await readdir(root), []);
});
