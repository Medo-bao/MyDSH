import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readHarnessRuntimeLayout } from "@minke/desktop/main/harness-launch.ts";
import { preparePackageManagerBin, packageManagerEnvironment } from "@minke/desktop/main/package-manager-path.ts";
import { runCancellableProcess } from "@minke/desktop/main/cancellable-process.ts";

const home = await mkdtemp(join(tmpdir(), "mydsh-plugin-smoke-"));
try {
  const runtime = await readHarnessRuntimeLayout();
  const bin = await preparePackageManagerBin(home, runtime);
  const env = { ...packageManagerEnvironment(process.env, bin, runtime.nodeExecutable), DSH_HOME: home };
  const root = join(home, "profiles", "web");
  const plugin = join(home, "fixture");
  await mkdir(root, { recursive: true });
  await mkdir(plugin);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "profile-smoke", private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }));
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n");
  await writeFile(join(plugin, "package.json"), JSON.stringify({ name: "mydsh-smoke-plugin", version: "1.0.0", dsh: { bundle: { patch: "cordis.patch.yml" } } }));
  await writeFile(join(plugin, "cordis.patch.yml"), "{}\n");
  const invoke = args => runCancellableProcess(runtime.nodeExecutable, [runtime.dshEntryPath, "plugin", "--profile", "web", ...args], { cwd: home, env, signal: AbortSignal.timeout(120_000) });
  await invoke(["add", `file:${plugin.replaceAll("\\", "/")}`, "--ignore-scripts"]);
  let profile = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.ok(profile.dependencies["mydsh-smoke-plugin"]);
  assert.ok(profile.dsh.profile.bundles.includes("mydsh-smoke-plugin"));
  await invoke(["remove", "mydsh-smoke-plugin"]);
  profile = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(profile.dependencies?.["mydsh-smoke-plugin"], undefined);
  assert.equal(profile.dsh.profile.bundles.includes("mydsh-smoke-plugin"), false);
  console.log("Upstream dsh plugin add/remove and bundle registration passed with the private Corepack shim.");
} finally { await rm(home, { recursive: true, force: true }); }
