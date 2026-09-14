import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { preparePackageManagerBin, packageManagerEnvironment } from "@minke/desktop/main/package-manager-path.ts";
import { profileDependenciesInstalled, quarantineIncompleteModules } from "@minke/desktop/main/system-plugin-installer.ts";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "mydsh-pnpm-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
test("Harness uses the validated pnpm command ahead of inherited wrappers", async t => {
  const home = await fixture(t);
  const bin = await preparePackageManagerBin(home, { pnpmExecutable: "C:\\Program Files\\nodejs\\node.exe", pnpmArguments: ["C:\\Program Files\\nodejs\\corepack.js", "pnpm"] });
  const shim = await readFile(join(bin, "pnpm.cmd"), "utf8");
  assert.match(shim, /"C:\\Program Files\\nodejs\\node.exe"/);
  assert.ok(shim.endsWith('"pnpm" %*\r\n'));
  const env = packageManagerEnvironment({ Path: "broken-path", USER_TEST: "kept" }, bin, process.execPath);
  assert.equal(env.Path, undefined);
  assert.equal(env.PATH.split(delimiter)[0], bin);
  assert.ok(env.PATH.endsWith("broken-path"));
  assert.equal(env.USER_TEST, "kept");
});
test("cached plugin state cannot hide missing installed dependencies", async t => {
  const home = await fixture(t);
  const root = join(home, "profiles", "web");
  await mkdir(join(root, "node_modules", "example"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { example: "1.0.0" } }));
  assert.equal(await profileDependenciesInstalled(home), false);
  await writeFile(join(root, "node_modules", "example", "package.json"), JSON.stringify({ name: "example", version: "1.0.0" }));
  assert.equal(await profileDependenciesInstalled(home), false, "Missing pnpm metadata requires repair");
  await writeFile(join(root, "node_modules", ".modules.yaml"), "nodeLinker: hoisted\n");
  assert.equal(await profileDependenciesInstalled(home), true);
  assert.equal(await profileDependenciesInstalled(home, ["desktop-overlay"]), false);
  const backup = await quarantineIncompleteModules(home);
  await access(join(backup, "example", "package.json"));
  await assert.rejects(access(join(root, "node_modules")), { code: "ENOENT" });
  assert.equal(await quarantineIncompleteModules(home), undefined);
});
