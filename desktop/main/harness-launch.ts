import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SYSTEM_TOOL_REQUIREMENTS = Object.freeze({
  node: 24,
  pnpm: 11,
  dsh: undefined,
  git: undefined,
  corepack: undefined,
  python: 3,
  cargo: undefined,
  rustc: undefined,
} satisfies Readonly<Record<string, number | undefined>>);

export interface HarnessRuntimeLayout {
  dshEntryPath: string;
  dshPackageRoot: string;
  dshShimPath: string;
  dshVersion: string;
  nodeExecutable: string;
  pnpmArguments: readonly string[];
  pnpmExecutable: string;
}

export async function readHarnessRuntimeLayout(
  pathValue: string | undefined = process.env.PATH,
): Promise<HarnessRuntimeLayout> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("MyDSH supports only Windows x64");
  }
  const { nodeExecutable, pnpmArguments, pnpmExecutable } = await readSystemToolchain(pathValue);
  const pnpm = { executable: pnpmExecutable, arguments: pnpmArguments };
  const dshShimPath = await resolveSystemShim("dsh", pathValue);
  const dshPackageRoot = await resolveGlobalPackageRoot(
    pnpm.executable,
    pnpm.arguments,
    "@deepseek-ai/dsh",
  );
  const dshManifest = JSON.parse(
    await readFile(join(dshPackageRoot, "package.json"), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (dshManifest.name !== "@deepseek-ai/dsh" || typeof dshManifest.version !== "string") {
    throw new Error("System pnpm resolved an invalid @deepseek-ai/dsh package");
  }
  const dshEntryPath = join(dshPackageRoot, "lib", "bin.js");
  await access(dshEntryPath);
  await verifyDshShim(dshShimPath, dshEntryPath, dshManifest.version, nodeExecutable);
  return { dshEntryPath, dshPackageRoot, dshShimPath, dshVersion: dshManifest.version,
    nodeExecutable, pnpmArguments, pnpmExecutable };
}

/** Resolve recovery tools without requiring a healthy DSH installation. */
export async function readSystemToolchain(pathValue = process.env.PATH) {
  const nodeExecutable = await resolveSystemTool(
    "node",
    pathValue,
    SYSTEM_TOOL_REQUIREMENTS.node,
  );
  const pnpm = await resolveCorepackPnpm(nodeExecutable);
  return {
    nodeExecutable,
    pnpmArguments: pnpm.arguments,
    pnpmExecutable: pnpm.executable,
  };
}

async function verifyDshShim(
  shimPath: string,
  expectedEntryPath: string,
  expectedVersion: string,
  nodeExecutable: string,
): Promise<void> {
  if (extname(shimPath).toLowerCase() === ".cmd") {
    const source = await readFile(shimPath, "utf8");
    const targets = parseCmdShimTargets(shimPath, source);
    const expected = (await realpath(expectedEntryPath)).toLowerCase();
    const resolvedTargets = await Promise.all(targets.map(async (target) => (await realpath(target)).toLowerCase()));
    if (resolvedTargets.length === 0 || resolvedTargets.some((target) => target !== expected)) {
      throw new Error(
        `PATH dsh shim does not target the pnpm-resolved package (${shimPath})`,
      );
    }
  }
  const { stdout, stderr } = await execFileAsync(
    extname(shimPath).toLowerCase() === ".cmd" ? nodeExecutable : shimPath,
    extname(shimPath).toLowerCase() === ".cmd" ? [expectedEntryPath, "--version"] : ["--version"],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  const version = `${stdout}\n${stderr}`.trim();
  if (parseVersionToken(version) !== expectedVersion) {
    throw new Error(
      `PATH dsh shim version ${JSON.stringify(version)} does not match ${JSON.stringify(expectedVersion)}`,
    );
  }
}

export function parseCmdShimTargets(shimPath: string, source: string): string[] {
  const directory = dirname(shimPath);
  const targets: string[] = [];
  for (const match of source.matchAll(/["']([^"']+[/\\]lib[/\\]bin\.js)["']/giu)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const expanded = raw.replace(/%~dp0/giu, `${directory}\\`);
    targets.push(resolve(expanded));
  }
  return targets;
}

function parseVersionToken(value: string): string | undefined {
  const match = /(?:^|\s)v?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/u.exec(value);
  return match?.[1];
}

async function resolveCorepackPnpm(nodeExecutable: string): Promise<{
  arguments: readonly string[];
  executable: string;
}> {
  const entryPath = join(
    dirname(nodeExecutable),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  );
  await access(entryPath);
  const argumentsPrefix = [entryPath, "pnpm"] as const;
  const { stdout, stderr } = await execFileAsync(
    nodeExecutable,
    [...argumentsPrefix, "--version"],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  const version = `${stdout}\n${stderr}`.trim();
  const major = parseMajorVersion(version);
  if (major === undefined || major < SYSTEM_TOOL_REQUIREMENTS.pnpm) {
    throw new Error(`System Corepack pnpm >= 11 was not found (${version})`);
  }
  return { arguments: argumentsPrefix, executable: nodeExecutable };
}

export function harnessWebArguments(): string[] {
  return ["web", "--host", "127.0.0.1", "--port", "0", "--no-open"];
}

export async function resolveSystemTool(
  name: string,
  pathValue: string | undefined = process.env.PATH,
  minimumMajor?: number,
): Promise<string> {
  const candidates = commandCandidates(name, pathValue);
  const rejected: string[] = [];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const { stdout, stderr } = await execFileAsync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      });
      const output = `${stdout}\n${stderr}`.trim();
      if (minimumMajor !== undefined) {
        const major = parseMajorVersion(output);
        if (major === undefined || major < minimumMajor) {
          rejected.push(`${candidate} (${output || "unknown version"})`);
          continue;
        }
      }
      return candidate;
    } catch (error) {
      rejected.push(
        `${candidate} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  const requirement = minimumMajor === undefined
    ? ""
    : ` >= ${String(minimumMajor)}`;
  const detail = rejected.length === 0 ? "" : `; rejected: ${rejected.join(", ")}`;
  throw new Error(`System ${name}${requirement} was not found on PATH${detail}`);
}

async function resolveSystemShim(
  name: string,
  pathValue: string | undefined,
): Promise<string> {
  const roots = (pathValue ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/gu, ""))
    .filter(Boolean);
  for (const root of roots) {
    for (const suffix of [".exe", ".com", ".cmd"] as const) {
      const candidate = join(root, `${name}${suffix}`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Continue through PATH in order.
      }
    }
  }
  throw new Error(`System ${name} was not found on PATH`);
}

export function commandCandidates(name: string, pathValue: string | undefined): string[] {
  const suffixes = name === "node"
    ? [".exe"]
    : [".exe", ".com"];
  const roots = (pathValue ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/gu, ""))
    .filter(Boolean);
  return [...new Set(roots.flatMap((root) =>
    suffixes.map((suffix) => join(root, `${name}${suffix}`))
  ))];
}

export function parseMajorVersion(value: string): number | undefined {
  const match = /(?:^|\s)v?(\d+)(?:\.\d+){1,}/u.exec(value);
  if (match?.[1] === undefined) return undefined;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) ? major : undefined;
}

async function resolveGlobalPackageRoot(
  pnpmExecutable: string,
  pnpmArguments: readonly string[],
  packageName: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    pnpmExecutable,
    [...pnpmArguments, "list", "--global", "--parseable", "--depth", "-1", packageName],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  const candidates = stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  for (const candidate of candidates.reverse()) {
    try {
      const manifest = JSON.parse(
        await readFile(join(candidate, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (manifest.name === packageName) return candidate;
    } catch {
      // Continue through pnpm's parseable output.
    }
  }
  throw new Error(`System pnpm did not report an installed ${packageName} package`);
}
