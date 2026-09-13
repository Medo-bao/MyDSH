import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const ZSTD_MAGIC = 0xfd2fb528;

export type SessionCompletion = Readonly<{
  title: string;
  body: string;
  sessionId?: string;
}>;

type SessionRecord = {
  consumed: number;
  size: number;
  baseline: boolean;
  hasTurnEvents: boolean;
  header?: Record<string, unknown>;
  title?: string;
};

export function scanZstdFrames(buffer: Buffer): ReadonlyArray<{
  start: number;
  end: number;
}> {
  const frames: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const start = offset;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    offset += 4;
    const descriptor = buffer[offset++];
    if ((descriptor & 0x18) !== 0) break;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag;
    const remainingHeader =
      (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (offset + remainingHeader > buffer.length) break;
    offset += remainingHeader;

    let complete = false;
    while (offset + 3 <= buffer.length) {
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const last = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) return frames;
      const payloadSize = blockType === 1 ? 1 : blockSize;
      if (offset + payloadSize > buffer.length) return frames;
      offset += payloadSize;
      if (last) {
        complete = true;
        break;
      }
    }
    if (!complete || (checksum && offset + 4 > buffer.length)) break;
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

function expandEvent(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) return [];
  const row = value as Record<string, unknown>;
  if (
    ["text-chunks", "reasoning-chunks"].includes(String(row.type)) &&
    typeof row.data === "object" && row.data !== null
  ) {
    const texts = (row.data as Record<string, unknown>).texts;
    return Array.isArray(texts) ? texts : [];
  }
  if (
    row.type === "tool-call-chunks" &&
    typeof row.data === "object" && row.data !== null
  ) {
    const args = (row.data as Record<string, unknown>).args;
    return Array.isArray(args) ? args : [];
  }
  return [row];
}

async function listSessionLogs(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const generations = entries.filter((entry) => entry.isFile()
      && /^session(?:\.v[1-3])?\.jsonl\.zstd$/u.test(entry.name));
    generations.sort((a, b) => Number(/\.v([1-3])\./u.exec(b.name)?.[1] ?? 0)
      - Number(/\.v([1-3])\./u.exec(a.name)?.[1] ?? 0));
    if (generations[0]) output.push(join(directory, generations[0].name));
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
    }));
  };
  await visit(root);
  return output;
}

export class SessionCompletionWatcher {
  readonly #records = new Map<string, SessionRecord>();
  readonly sessionsRoot: string;
  readonly onCompletion: (completion: SessionCompletion) => void;
  readonly intervalMs: number;
  #timer: NodeJS.Timeout | undefined;

  constructor(
    sessionsRoot: string,
    onCompletion: (completion: SessionCompletion) => void,
    intervalMs = 2_000,
  ) {
    this.sessionsRoot = sessionsRoot;
    this.onCompletion = onCompletion;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.#timer !== undefined) return;
    void this.scan();
    this.#timer = setInterval(() => void this.scan(), this.intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async scan(): Promise<void> {
    for (const path of await listSessionLogs(this.sessionsRoot)) {
      await this.#process(path);
    }
  }

  async #process(path: string): Promise<void> {
    let details;
    try {
      details = await stat(path);
    } catch {
      this.#records.delete(path);
      return;
    }
    const record = this.#records.get(path) ?? {
      consumed: 0,
      size: 0,
      baseline: false,
      hasTurnEvents: false,
    };
    this.#records.set(path, record);
    if (record.size === details.size) return;

    const buffer = await readFile(path);
    let completions = 0;
    for (const frame of scanZstdFrames(buffer)) {
      if (frame.start < record.consumed) continue;
      let contents: string;
      try {
        contents = zstdDecompressSync(
          buffer.subarray(frame.start, frame.end),
        ).toString("utf8");
      } catch {
        break;
      }
      for (const line of contents.split("\n")) {
        if (line === "") continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          continue;
        }
        for (const event of expandEvent(value)) {
          if (typeof event !== "object" || event === null) continue;
          const row = event as Record<string, unknown>;
          if (record.header === undefined && row.type === "session") {
            record.header = row;
          }
          if (
            row.type === "session/title" &&
            typeof row.data === "object" && row.data !== null
          ) {
            const title = (row.data as Record<string, unknown>).title;
            if (typeof title === "string") record.title = title;
          }
          if (row.type === "turn/start" || row.type === "turn/end") {
            record.hasTurnEvents = true;
          }
          if (row.type === "turn/end") completions += 1;
          if (!record.hasTurnEvents && row.type === "assistant/message") {
            completions += 1;
          }
        }
      }
      record.consumed = frame.end;
    }
    record.size = details.size;
    const live = record.baseline;
    record.baseline = true;
    if (!live || completions === 0) return;

    const header = record.header ?? {};
    if (Number(header.delegationDepth ?? 0) > 0) return;
    const sessionId = typeof header.id === "string" ? header.id : undefined;
    const cwd = typeof header.cwd === "string" ? header.cwd : undefined;
    const body = [
      cwd === undefined ? undefined : basename(cwd),
      sessionId === undefined ? undefined : `会话 ${sessionId.slice(-8)}`,
      completions > 1 ? `${completions} 轮任务完成` : undefined,
    ].filter((part): part is string => part !== undefined).join(" · ");
    this.onCompletion({
      title: record.title ?? "DeepSeek Harness 任务完成",
      body,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  }
}
