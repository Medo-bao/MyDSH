import assert from "node:assert/strict";
import test from "node:test";
import { runCancellableProcess } from "@minke/desktop/main/cancellable-process.ts";

test("installation subprocess cancellation waits for process exit", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 250);
  try {
    await assert.rejects(runCancellableProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: process.cwd(), env: process.env, signal: controller.signal }), { name: "AbortError" });
  } finally { clearTimeout(timer); }
});

test("pre-cancelled installation never starts and spawn failures settle", async () => {
  await assert.rejects(runCancellableProcess("not-a-real-mydsh-command", [], { cwd: process.cwd(), env: process.env, signal: AbortSignal.abort() }), { name: "AbortError" });
  await assert.rejects(runCancellableProcess("not-a-real-mydsh-command", [], { cwd: process.cwd(), env: process.env, signal: new AbortController().signal }), /ENOENT/);
});

test("installation deadline stops an unresponsive subprocess", async () => {
  await assert.rejects(runCancellableProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(150) }), { name: "TimeoutError" });
});
