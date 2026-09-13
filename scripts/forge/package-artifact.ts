import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  applicationExecutablePath,
  applicationResourcesRoot,
} from "./application-layout.mjs";

const desktopPlatform = "win32";
const desktopArch = "x64";

export interface PackageArtifactPolicy {
  readonly schemaVersion: number;
  readonly appSizeBudgetBytes: Readonly<Record<string, number>>;
}

export interface PackageArtifactVerificationOptions {
  readonly appSizeBudgetBytes?: number;
  readonly arch: string;
  readonly platform: string;
  readonly productPackageName: string;
  readonly runtimeFileBudget: number;
  readonly runtimeSizeBudgetBytes: number;
}

export interface ArtifactTreeStats {
  readonly bytes: number;
  readonly files: number;
}

export interface PackageArtifactReport {
  readonly app: ArtifactTreeStats;
  readonly host: ArtifactTreeStats;
}

async function requireRegularFile(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`packaged application is missing required file ${path}`);
    }
    throw error;
  }
  if (!info.isFile()) {
    throw new Error(`packaged application required file is not regular: ${path}`);
  }
}

async function requireMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error(`packaged application contains forbidden path ${path}`);
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    error.code === "ENOENT";
}

async function treeStats(root: string): Promise<ArtifactTreeStats> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`packaged application tree is not a directory: ${root}`);
  }
  let bytes = 0;
  let files = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const info = await lstat(path);
      if (!info.isFile() && !info.isSymbolicLink()) {
        throw new Error(`packaged application contains special file ${path}`);
      }
      bytes += info.size;
      files += 1;
    }
  }
  await visit(root);
  return { bytes, files };
}

export function parsePackageArtifactPolicy(value: unknown): PackageArtifactPolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("package artifact policy must be an object");
  }
  const candidate = value as {
    schemaVersion?: unknown;
    appSizeBudgetBytes?: unknown;
  };
  if (candidate.schemaVersion !== 1) {
    throw new Error("package artifact policy schemaVersion must be 1");
  }
  if (
    candidate.appSizeBudgetBytes === null ||
    typeof candidate.appSizeBudgetBytes !== "object" ||
    Array.isArray(candidate.appSizeBudgetBytes)
  ) {
    throw new Error("package artifact policy must declare appSizeBudgetBytes");
  }
  const budgets = candidate.appSizeBudgetBytes as Record<string, unknown>;
  for (const [platform, budget] of Object.entries(budgets)) {
    if (platform.length === 0 || !Number.isSafeInteger(budget) || (budget as number) <= 0) {
      throw new Error(`invalid package artifact size budget for ${JSON.stringify(platform)}`);
    }
  }
  if (Object.keys(budgets).length !== 1 || !(desktopPlatform in budgets)) {
    throw new Error("package artifact policy must only declare win32");
  }
  return candidate as PackageArtifactPolicy;
}

export async function verifyPackagedApplication(
  outputPath: string,
  options: PackageArtifactVerificationOptions,
): Promise<PackageArtifactReport> {
  if (options.platform !== desktopPlatform || options.arch !== desktopArch) {
    throw new Error(`unsupported packaged application target ${options.platform}-${options.arch}`);
  }
  const appRoot = outputPath;
  const resourcesRoot = applicationResourcesRoot(appRoot, options.platform);
  const productRoot = join(resourcesRoot, "harness-overlay");
  const companionRoot = join(resourcesRoot, "companion-plugins");
  await Promise.all([
    requireRegularFile(applicationExecutablePath(appRoot, options.platform)),
    requireRegularFile(join(resourcesRoot, "app.asar")),
    requireRegularFile(join(productRoot, "package.json")),
    requireRegularFile(join(productRoot, "lib", "index.js")),
    requireRegularFile(join(productRoot, "lib", "client.js")),
    requireRegularFile(join(productRoot, "companion.contract.json")),
  ]);
  await Promise.all([
    requireMissing(join(resourcesRoot, "host")),
    requireMissing(join(resourcesRoot, "node")),
    requireMissing(join(resourcesRoot, "node.exe")),
    requireMissing(join(resourcesRoot, "pnpm")),
    requireMissing(join(resourcesRoot, "dsh")),
  ]);
  const companion = await treeStats(companionRoot);
  const product = await treeStats(productRoot);
  const plugins = {
    bytes: companion.bytes + product.bytes,
    files: companion.files + product.files,
  };
  if (plugins.files > options.runtimeFileBudget) {
    throw new Error(
      `packaged plugins contain ${String(plugins.files)} files, above the ${String(options.runtimeFileBudget)} file budget`,
    );
  }
  if (plugins.bytes > options.runtimeSizeBudgetBytes) {
    throw new Error("packaged plugins exceed the configured size budget");
  }
  const app = await treeStats(appRoot);
  if (options.appSizeBudgetBytes !== undefined && app.bytes > options.appSizeBudgetBytes) {
    throw new Error("packaged application exceeds the configured size budget");
  }
  return { app, host: plugins };
}
