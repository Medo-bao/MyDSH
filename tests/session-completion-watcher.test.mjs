import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import {
  scanZstdFrames,
  SessionCompletionWatcher,
} from "@minke/desktop/main/session-completion-watcher.ts";

function frame(...rows) {
  return zstdCompressSync(Buffer.from(`${rows.map(JSON.stringify).join("\n")}\n`));
}

for (const version of [0, 3]) test(`session completion watcher reads v${version} live turns and ignores history`, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-completion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "workspace", "session");
  const path = join(directory, version === 0 ? "session.jsonl.zstd" : "session.v3.jsonl.zstd");
  await mkdir(directory, { recursive: true });

  const baseline = frame(
    { type: "session", version, id: "session-12345678", cwd: "C:/work/demo", delegationDepth: 0 },
    { type: "session/title", data: { title: "示例任务" } },
    { type: "turn/start" },
    { type: "turn/end" },
  );
  const live = frame({ type: "turn/start" }, { type: "turn/end" });
  assert.deepEqual(scanZstdFrames(Buffer.concat([baseline, live])), [
    { start: 0, end: baseline.length },
    { start: baseline.length, end: baseline.length + live.length },
  ]);

  await writeFile(path, baseline);
  const completions = [];
  const watcher = new SessionCompletionWatcher(root, (value) => completions.push(value));
  await watcher.scan();
  assert.deepEqual(completions, []);

  await appendFile(path, live);
  await watcher.scan();
  assert.deepEqual(completions, [{
    title: "示例任务",
    body: "demo · 会话 12345678",
    sessionId: "session-12345678",
  }]);
});
