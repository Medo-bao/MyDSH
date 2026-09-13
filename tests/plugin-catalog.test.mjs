import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { systemPluginSpecs, pluginContentHash } from "@minke/desktop/main/system-plugin-installer.ts";

test("plugin fingerprints detect same-version security fixes and ignore nested dependencies", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "firefly-plugin-hash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, "package.json"), '{"version":"1.0.0"}');
  await writeFile(resolve(root, "client.js"), "unsafe");
  const before = await pluginContentHash(root);
  await writeFile(resolve(root, "client.js"), "fixed");
  const after = await pluginContentHash(root);
  assert.notEqual(before, after);
  await mkdir(resolve(root, "node_modules"));
  await writeFile(resolve(root, "node_modules", "ignored.js"), "dependency");
  assert.equal(await pluginContentHash(root), after);
  await rm(resolve(root, "client.js"));
  assert.notEqual(await pluginContentHash(root), after);
});

test("system plugin versions follow the resolved DSH package", () => {
  const specs = systemPluginSpecs("0.1.1-rc.2");
  assert.equal(specs.length, 8);
  assert.ok(specs.slice(0, 7).every((spec) => spec.endsWith("@0.1.1-rc.2")));
  assert.equal(specs[7], "@deepseek-ai/cordis@^4.0.1");
  assert.throws(() => systemPluginSpecs("latest"), /Invalid resolved/);
});

const configured = JSON.parse(await readFile(
  new URL("../config/companion-plugins.json", import.meta.url),
  "utf8",
));

test("no optional plugins are configured or shipped", async () => {
  const actual = [];
  for (const plugin of configured.plugins) {
    const manifest = JSON.parse(await readFile(
      new URL(`../resources/companion-plugins/${plugin.directory}/package.json`, import.meta.url),
      "utf8",
    ));
    actual.push({ name: manifest.name, version: manifest.version });
  }
  assert.deepEqual(actual, []);
  assert.deepEqual(await readdir(new URL("../resources/companion-plugins/", import.meta.url)), [".gitkeep"]);
});

test("plugin registry has unique safe ids, names, and directories", async () => {
  const ids = configured.plugins.map((plugin) => plugin.id);
  const names = configured.plugins.map((plugin) => plugin.name);
  const directories = configured.plugins.map((plugin) => plugin.directory);
  assert.equal(new Set(ids).size, ids.length, "plugin ids must be unique");
  assert.equal(new Set(names).size, names.length, "plugin names must be unique");
  assert.equal(
    new Set(directories).size,
    directories.length,
    "plugin directories must be unique",
  );

  const root = resolve(fileURLToPath(new URL("../resources/companion-plugins", import.meta.url)));
  for (const plugin of configured.plugins) {
    assert.match(plugin.id, /^[a-z0-9][a-z0-9-]*$/u, `${plugin.id} has an unsafe id`);
    assert.match(plugin.directory, /^[a-z0-9][a-z0-9-]*$/u, `${plugin.directory} has an unsafe directory`);
    const directory = resolve(root, plugin.directory);
    assert.equal(directory.startsWith(`${root}\\`), true, `${plugin.directory} escapes the plugin root`);
    const manifest = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
    assert.equal(manifest.name, plugin.name, `${plugin.directory} manifest name drifted`);
    assert.equal(typeof manifest.version, "string", `${plugin.directory} manifest version is missing`);
  }
});

test("retired plugin settings and privileged bridge are not registered", async () => {
  const client = await readFile(new URL("../packages/harness-overlay/src/client/index.tsx", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload/desktop-preload.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /plugin-catalog|firefly-bundled-plugins|PluginCatalog/u);
  assert.doesNotMatch(preload, /dshDesktop|BALANCE_REFRESH_CHANNEL|COMPANION_REVERT_FILES_CHANNEL/u);
  const patch = await readFile(new URL("../packages/harness-overlay/cordis.patch.yml", import.meta.url), "utf8");
  for (const id of ["ui-settings-plugins", "ui-settings-plugin-inventory"]) {
    assert.doesNotMatch(patch, new RegExp(`- id: ${id}\\s+disabled: true`, "u"));
  }
});
