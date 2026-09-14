import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pluginInstallTransaction } from "./plugin-install-transaction.ts";

interface PluginDescriptor {
  bundlePatch: boolean;
  name: string;
  peerDependencies: Record<string, string>;
  root: string;
  version: string;
}

interface InstalledState {
  schemaVersion: 9;
  appVersion: string;
  plugins: Array<{ name: string; version: string }>;
  contentHashes: string[];
}

const SYSTEM_PLUGIN_NAMES = [
  "@deepseek-ai/dsh-invariants",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-sdk-protocol",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-subagent",
  "@deepseek-ai/dsh-subprocess",
  "@deepseek-ai/dsh-timeout",
] as const;

/** Build host plugin specs from the version resolved by the active dsh CLI. */
export function systemPluginSpecs(dshVersion: string): readonly string[] {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(dshVersion)) {
    throw new Error(`Invalid resolved DSH version ${JSON.stringify(dshVersion)}`);
  }
  return [
    ...SYSTEM_PLUGIN_NAMES.map((name) => `${name}@${dshVersion}`),
    "@deepseek-ai/cordis@^4.0.1",
  ];
}

const RETIRED_SYSTEM_PLUGIN_NAMES = [
  "@deepseek-ai/dsh-subagent-codex",
  "dsh-session-manager",
  "@deepseek-ai/dsh-third-party-thinking",
  "dsh-third-party-thinking",
  "@deepseek-ai/dsh-file-changes",
  "@deepseek-ai/dsh-client-file-changes",
  "@deepseek-ai/dsh-balance",
  "@deepseek-ai/dsh-prompt-custom",
  "@deepseek-ai/dsh-conversation-tweaks",
  "@dsh-external/dsh-vision",
  "@dsh-external/dsh-side-session",
  "@vlln/dsh-navbar",
  "@deepseek-ai/dsh-client-web-react",
] as const;

export async function installFireflyPlugins(options: Readonly<{
  appVersion: string;
  companionRoot: string;
  dshHome: string;
  dshVersion: string;
  pnpmArguments: readonly string[];
  pnpmExecutable: string;
  productRoot: string;
  statePath: string;
}>): Promise<void> {
  const transaction = await pluginInstallTransaction(options.dshHome, options.statePath);
  const systemPlugins = systemPluginSpecs(options.dshVersion);
  const plugins = [
    await readPlugin(options.productRoot),
    ...await readCompanionPlugins(options.companionRoot),
  ];
  const expected: InstalledState = {
    schemaVersion: 9,
    appVersion: options.appVersion,
    contentHashes: await Promise.all(plugins.map((plugin) => pluginContentHash(plugin.root))),
    plugins: [
      ...systemPlugins.map((name) => ({ name, version: "system" })),
      ...plugins.map(({ name, version }) => ({ name, version })),
    ],
  };
  if (await stateMatches(options.statePath, expected)) {
    try {
      const actual = await Promise.all(plugins.map((plugin, index) =>
        pluginContentHash(join(options.dshHome, "firefly-plugins", stagingDirectory(plugin, index)))));
      if (actual.every((hash, index) => hash === expected.contentHashes[index])
        && await profileDependenciesInstalled(options.dshHome, plugins.map(plugin => plugin.name))) return;
    } catch { /* Missing staged files must be repaired. */ }
  }

  await transaction(async () => {
  await mkdir(options.dshHome, { recursive: true });
  await ensureWebProfile(options.dshHome);
  await ensureProfileBuildPolicy(options.dshHome);
  await repairLegacyProfileManifest(options.dshHome);
  if (!await profileDependenciesInstalled(options.dshHome)) await quarantineIncompleteModules(options.dshHome);
  const installedManagedPlugins = await installedPluginNames(
    options.dshHome,
    [
      ...plugins.map((plugin) => plugin.name),
      ...RETIRED_SYSTEM_PLUGIN_NAMES,
    ],
  );
  if (installedManagedPlugins.length > 0) {
    await runPnpmPluginCommand(
      options.pnpmExecutable,
      options.pnpmArguments,
      ["remove", ...installedManagedPlugins],
      options.dshHome,
      `Firefly plugin removal failed for ${installedManagedPlugins.join(", ")}`,
    );
  }
  const stagedPlugins = await stagePlugins(
    plugins,
    join(options.dshHome, "firefly-plugins"),
  );
  const peerSpecs = peerDependencySpecs(plugins, options.dshVersion);
  await runPnpmPluginAdd(
    options.pnpmExecutable,
    options.pnpmArguments,
    [
      ...systemPlugins,
      ...peerSpecs,
      ...stagedPlugins.map((plugin) =>
        `file:${plugin.root.replaceAll("\\", "/")}`
      ),
    ],
    options.dshHome,
  );
  await reconcileOwnedBundles(options.dshHome, plugins);
  await writeStateAtomic(options.statePath, expected);
  });
}

export async function quarantineIncompleteModules(dshHome: string): Promise<string | undefined> {
  const modules = join(dshHome, "profiles", "web", "node_modules");
  try {
    if ((await lstat(modules)).isSymbolicLink()) throw new Error("Refusing redirected profile node_modules");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const backupRoot = join(dshHome, ".mydsh-damaged-modules");
  await mkdir(backupRoot, { recursive: true });
  if ((await lstat(backupRoot)).isSymbolicLink()) throw new Error("Refusing redirected module backup");
  const backup = join(backupRoot, randomUUID());
  // Rename the directory itself; never follow or delete legacy links inside it.
  await rename(modules, backup);
  return backup;
}

export async function profileDependenciesInstalled(dshHome: string, required: readonly string[] = []): Promise<boolean> {
  try {
    const root = join(dshHome, "profiles", "web");
    await readFile(join(root, "node_modules", ".modules.yaml"), "utf8");
    const profile = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const dependencies = profile.dependencies;
    if (!dependencies || typeof dependencies !== "object" || !Object.keys(dependencies).length) return false;
    if (required.some(name => !Object.hasOwn(dependencies, name))) return false;
    for (const name of Object.keys(dependencies)) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(name) || name === "." || name === "..") return false;
      const manifest = JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"));
      if (manifest.name !== name || typeof manifest.version !== "string") return false;
    }
    return true;
  } catch { return false; }
}

async function ensureWebProfile(dshHome: string): Promise<void> {
  const path = join(dshHome, "profiles", "web", "package.json");
  try {
    await readFile(path, "utf8");
    return;
  } catch {
    await writeStateAtomic(path, {
      name: "dsh-profile-web",
      private: true,
      dependencies: {},
      dsh: {
        profile: {
          bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
        },
      },
    });
  }
}

async function ensureProfileBuildPolicy(dshHome: string): Promise<void> {
  const profileRoot = join(dshHome, "profiles", "web");
  const path = join(profileRoot, "pnpm-workspace.yaml");
  await mkdir(profileRoot, { recursive: true });
  let yaml: string;
  try {
    yaml = await readFile(path, "utf8");
  } catch {
    yaml = "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n";
  }
  const lines = yaml.replaceAll("\r\n", "\n").split("\n");
  let blockStart = lines.findIndex((line) => line.trim() === "allowBuilds:");
  if (blockStart < 0) {
    while (lines.at(-1) === "") lines.pop();
    lines.push("allowBuilds:");
    blockStart = lines.length - 1;
  }
  let blockEnd = blockStart + 1;
  while (
    blockEnd < lines.length &&
    (lines[blockEnd]?.trim() === "" || /^\s+/u.test(lines[blockEnd] ?? ""))
  ) blockEnd += 1;

  for (const name of ["@google/genai", "protobufjs"]) {
    const entryPattern = new RegExp(
      `^\\s+['\"]?${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}['\"]?\\s*:`,
      "u",
    );
    const existing = lines.findIndex(
      (line, index) => index > blockStart && index < blockEnd && entryPattern.test(line),
    );
    const entry = `  ${name.startsWith("@") ? `'${name}'` : name}: false`;
    if (existing >= 0) lines[existing] = entry;
    else {
      lines.splice(blockEnd, 0, entry);
      blockEnd += 1;
    }
  }
  await writeFile(path, `${lines.join("\n").replace(/\n+$/u, "")}\n`, "utf8");
}

export function peerDependencySpecs(
  plugins: readonly PluginDescriptor[],
  dshVersion: string,
): string[] {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(dshVersion)) {
    throw new Error(`Invalid resolved DSH version ${JSON.stringify(dshVersion)}`);
  }
  const specifications = new Map<string, string>();
  for (const plugin of plugins) {
    for (const [name, range] of Object.entries(plugin.peerDependencies)) {
      const version =
        name.startsWith("@deepseek-ai/dsh-")
            ? dshVersion
            : range;
      specifications.set(name, `${name}@${version}`);
    }
  }
  return [...specifications.values()].sort();
}

async function stagePlugins(
  plugins: readonly PluginDescriptor[],
  stagingRoot: string,
): Promise<PluginDescriptor[]> {
  await mkdir(stagingRoot, { recursive: true });
  const staged: PluginDescriptor[] = [];
  for (const [index, plugin] of plugins.entries()) {
    const directory = stagingDirectory(plugin, index);
    const destination = join(stagingRoot, directory);
    const temporary = `${destination}.${String(process.pid)}.tmp`;
    await rm(temporary, { force: true, recursive: true });
    await cp(plugin.root, temporary, { recursive: true, filter: (source) => !["node_modules", ".git"].includes(basename(source)) });
    await rm(destination, { force: true, recursive: true });
    await rename(temporary, destination);
    staged.push({ ...plugin, root: destination });
  }
  const active = new Set(staged.map((plugin) => basename(plugin.root)));
  const managed = new Set([...plugins.map((plugin) => plugin.name), ...RETIRED_SYSTEM_PLUGIN_NAMES]);
  for (const entry of await readdir(stagingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || active.has(entry.name) || !/^\d{2}-[a-z0-9._-]+$/iu.test(entry.name)) continue;
    const path = join(stagingRoot, entry.name);
    let manifest: { name?: string };
    try { manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as typeof manifest; }
    catch { continue; }
    if (manifest.name && managed.has(manifest.name)) await rm(path, { recursive: true, force: true });
  }
  return staged;
}

function stagingDirectory(plugin: PluginDescriptor, index: number): string {
  return `${String(index).padStart(2, "0")}-${plugin.name.replace(/[^a-z0-9._-]+/giu, "-")}`;
}

export async function pluginContentHash(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      const name = `${prefix}${entry.name}`;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, `${name}/`);
      else if (entry.isFile()) {
        hash.update(JSON.stringify(name));
        hash.update(createHash("sha256").update(await readFile(path)).digest());
      } else throw new Error(`Unsupported plugin entry: ${path}`);
    }
  };
  await visit(root, "");
  return hash.digest("hex");
}

export async function repairLegacyProfileManifest(dshHome: string): Promise<void> {
  const path = join(dshHome, "profiles", "web", "package.json");
  let manifest: { dependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(await readFile(path, "utf8")) as typeof manifest;
  } catch {
    return;
  }
  const dependencies = manifest.dependencies ?? {};
  // These exact direct specs were installed by older desktop overlays. The
  // current bundle owns its host dependencies; React is supplied by the web host.
  const legacySpecs: Record<string, string> = {
    "@deepseek-ai/schemastery": "^3.18.1",
    react: "^19.2.8",
    zod: "3.0.0",
    "@deepseek-ai/dsh-client-ui-primitives": "0.1.5-alpha.1",
    "@deepseek-ai/dsh-client-ui-settings": "0.1.5-alpha.1",
    "@deepseek-ai/dsh-system-prompt": "0.1.5-alpha.1",
    "@deepseek-ai/dsh-tools": "0.1.5-alpha.1",
  };
  let changed = false;
  for (const [name, specification] of Object.entries(dependencies)) {
    if (
      legacySpecs[name] === specification ||
      /^link:Harness-win32-x64[\\/]/u.test(specification) ||
      (name === "Firefly" && /[\\/]out[\\/]Firefly$/u.test(specification))
    ) {
      delete dependencies[name];
      changed = true;
    }
  }
  if (changed) await writeStateAtomic(path, manifest);
}

export async function reconcileOwnedBundles(
  dshHome: string,
  plugins: readonly PluginDescriptor[],
): Promise<void> {
  const path = join(dshHome, "profiles", "web", "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as {
    dsh?: { profile?: { bundles?: string[] } };
  };
  const ownedNames = new Set([...plugins.map((plugin) => plugin.name), ...RETIRED_SYSTEM_PLUGIN_NAMES]);
  const current = Array.isArray(manifest.dsh?.profile?.bundles)
    ? manifest.dsh.profile.bundles
    : ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
  const bundles = current.filter((name) => !ownedNames.has(name));
  for (const plugin of plugins) {
    if (plugin.bundlePatch && !bundles.includes(plugin.name)) {
      bundles.push(plugin.name);
    }
  }
  manifest.dsh = {
    ...manifest.dsh,
    profile: { ...manifest.dsh?.profile, bundles },
  };
  await writeStateAtomic(path, manifest);
}

async function installedPluginNames(
  dshHome: string,
  ownedNames: readonly string[],
): Promise<string[]> {
  const path = join(dshHome, "profiles", "web", "package.json");
  try {
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    const dependencies = manifest.dependencies ?? {};
    return ownedNames.filter((name) => Object.hasOwn(dependencies, name));
  } catch {
    return [];
  }
}

async function readCompanionPlugins(root: string): Promise<PluginDescriptor[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const plugins = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => readPlugin(join(root, entry.name))),
  );
  const names = plugins.map((plugin) => plugin.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Firefly companion plugin names must be unique");
  }
  return plugins;
}

async function readPlugin(root: string): Promise<PluginDescriptor> {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as {
    dsh?: unknown;
    name?: unknown;
    peerDependencies?: unknown;
    version?: unknown;
  };
  if (
    typeof manifest.name !== "string" || manifest.name === "" ||
    typeof manifest.version !== "string" || manifest.version === ""
  ) {
    throw new Error(`Invalid Firefly plugin manifest at ${root}`);
  }
  const peerDependencies =
    typeof manifest.peerDependencies === "object" &&
      manifest.peerDependencies !== null &&
      !Array.isArray(manifest.peerDependencies)
      ? Object.fromEntries(
        Object.entries(manifest.peerDependencies).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
      : {};
  return {
    bundlePatch: hasBundlePatch(manifest.dsh),
    name: manifest.name,
    peerDependencies,
    root,
    version: manifest.version,
  };
}

function hasBundlePatch(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const bundle = (value as { bundle?: unknown }).bundle;
  if (typeof bundle !== "object" || bundle === null || Array.isArray(bundle)) {
    return false;
  }
  return typeof (bundle as { patch?: unknown }).patch === "string";
}

async function stateMatches(path: string, expected: InstalledState): Promise<boolean> {
  try {
    const current = JSON.parse(await readFile(path, "utf8")) as InstalledState;
    return JSON.stringify(current) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

async function writeStateAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function runPnpmPluginAdd(
  pnpmExecutable: string,
  pnpmArguments: readonly string[],
  pluginSpecs: readonly string[],
  dshHome: string,
): Promise<void> {
  await runPnpmPluginCommand(
    pnpmExecutable,
    pnpmArguments,
    ["add", ...pluginSpecs],
    dshHome,
    `System Harness plugin installation failed for ${pluginSpecs.join(", ")}`,
  );
}

async function runPnpmPluginCommand(
  pnpmExecutable: string,
  pnpmArguments: readonly string[],
  command: readonly string[],
  dshHome: string,
  failureMessage: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      pnpmExecutable,
      [...pnpmArguments, ...command],
      {
        cwd: join(dshHome, "profiles", "web"),
        env: { ...process.env, DSH_HOME: dshHome },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let output = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { output += chunk; });
    child.stderr?.on("data", (chunk: string) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(
        `${failureMessage} (code ${String(code)}, signal ${String(signal)})\n` +
        output.slice(-4_000),
      ));
    });
  });
}
