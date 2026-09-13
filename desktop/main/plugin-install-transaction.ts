import { copyFile, cp, lstat, mkdir, readFile, readlink, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

type Journal = { phase: "copying" | "ready" | "committed"; existed: boolean[] };

// Resolve existing ancestors too: a dangling target can still use a Windows
// short-name alias or a junction for the portion of its path that exists.
async function canonicalTarget(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return join(await canonicalTarget(dirname(path)), basename(path));
  }
}

async function copySnapshot(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    verbatimSymlinks: true,
    filter: async (from, to) => {
      if (!(await lstat(from)).isSymbolicLink()) return true;
      const original = resolve(dirname(from), await readlink(from));
      const within = relative(source, await canonicalTarget(original));
      const target = within !== ".." && !within.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(within)
        ? resolve(destination, within) : original;
      await mkdir(dirname(to), { recursive: true });
      if (process.platform !== "win32") {
        await symlink(target, to);
      } else {
        let file = false;
        try { file = (await stat(from)).isFile(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        // pnpm package links (including stale directory links) need no symlink privilege.
        // File links are materialized so later writes cannot mutate the snapshot.
        if (file) await copyFile(from, to);
        else await symlink(target, to, "junction");
      }
      return false;
    },
  });
}

export async function pluginInstallTransaction(home: string, statePath: string) {
  await mkdir(home, { recursive: true });
  const root = await realpath(home);
  const requestedState = resolve(statePath);
  const stateParent = await realpath(dirname(requestedState));
  if (relative(root, stateParent) !== "") throw new Error("Plugin state must be directly inside DSH home");
  const state = join(root, basename(requestedState));
  const recovery = join(root, ".firefly-plugin-recovery");
  const journalPath = join(recovery, "journal.json");
  const targets = [join(root, "profiles", "web"), join(root, "firefly-plugins"), state];
  // Reject redirected ownership roots before any recursive mutation.
  for (const path of [join(root, "profiles"), recovery, ...targets]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing redirected plugin path: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const save = async (journal: Journal) => {
    await writeFile(`${journalPath}.tmp`, JSON.stringify(journal));
    await rename(`${journalPath}.tmp`, journalPath);
  };
  const recover = async () => {
    let journal: Journal;
    try { journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await rm(recovery, { recursive: true, force: true });
        return;
      }
      throw new Error("Unreadable plugin recovery journal", { cause: error });
    }
    if (!["copying", "ready", "committed"].includes(journal.phase)
      || !Array.isArray(journal.existed) || journal.existed.length !== targets.length
      || journal.existed.some((value) => typeof value !== "boolean")) throw new Error("Invalid plugin recovery journal");
    if (journal.phase === "ready") {
      for (const [index] of targets.entries()) {
        if (journal.existed[index] && (await lstat(join(recovery, String(index)))).isSymbolicLink()) {
          throw new Error("Refusing redirected plugin backup");
        }
      }
      for (const [index, target] of targets.entries()) {
        const backup = join(recovery, String(index));
        if (journal.existed[index]) await lstat(backup);
        await rm(target, { recursive: true, force: true });
        if (journal.existed[index]) {
          await mkdir(dirname(target), { recursive: true });
          await copySnapshot(backup, target);
        }
      }
    }
    await rm(recovery, { recursive: true, force: true });
  };
  await recover();
  return async (operation: () => Promise<void>) => {
    await mkdir(recovery, { recursive: true });
    const existed = await Promise.all(targets.map(async (target) => {
      try { await lstat(target); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    }));
    await save({ phase: "copying", existed });
    for (const [index, target] of targets.entries()) {
      if (existed[index]) await copySnapshot(target, join(recovery, String(index)));
    }
    await save({ phase: "ready", existed });
    try {
      await operation();
      await save({ phase: "committed", existed });
    } catch (error) {
      await recover();
      throw error;
    }
    await recover();
  };
}
