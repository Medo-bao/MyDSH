import { readFile, writeFile, rename, rm, realpath } from "node:fs/promises";
import { join, dirname, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

const ENTRY = "export function scheduleRestart(port = null) {";
const MARKER = "// mydsh-managed-restart-v1";
const ADAPTER = `${ENTRY}
    ${MARKER}
    if (process.env.MYDSH_MANAGED_RESTART === '1' && process.connected && typeof process.send === 'function') {
        process.send({ type: 'mydsh:restart' });
        return { pid: process.pid, helperPid: process.ppid };
    }`;

/** Preserve the market's request/operation guards; delegate only process ownership. */
export async function adaptMarketRestart(home: string): Promise<void> {
  const file = join(home, "profiles", "web", "node_modules", "dshmarket", "lib", "restart.js");
  let source: string;
  try { source = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (source.includes(MARKER)) return;
  const location = relative(await realpath(home), await realpath(dirname(file)));
  if (isAbsolute(location) || location === ".." || location.startsWith("../") || location.startsWith("..\\")) {
    throw new Error("Cannot adapt a plugin market outside the desktop data directory");
  }
  if (source.split(ENTRY).length !== 2) throw new Error("The installed plugin market restart API is incompatible with MyDSH");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    // Replace the directory entry, never mutate a pnpm store hardlink in place.
    await writeFile(temporary, source.replace(ENTRY, ADAPTER), { flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
