import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isCommandUnavailableResult,
  resolveCommandInvocation,
} from "../scripts/harness/command-invocation.mjs";
import { packagedApplicationLayout } from "../scripts/forge/application-layout.mjs";

const packageManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const forgeSource = await readFile(
  new URL("../forge.config.ts", import.meta.url),
  "utf8",
);
const forgeRunnerSource = await readFile(
  new URL("../scripts/forge/run.mjs", import.meta.url),
  "utf8",
);
const viteMainSource = await readFile(
  new URL("../vite.main.config.mts", import.meta.url),
  "utf8",
);

test("Windows batch adapters run through ComSpec", () => {
  assert.deepEqual(
    resolveCommandInvocation("C:\\runtime\\bin\\node.cmd", ["--version"], {
      comspec: "C:\\Windows\\System32\\cmd.exe",
      platform: "win32",
    }),
    {
      args: ["/d", "/c", "C:\\runtime\\bin\\node.cmd", "--version"],
      command: "C:\\Windows\\System32\\cmd.exe",
    },
  );
});

test("Windows missing-command output is recognized", () => {
  assert.equal(
    isCommandUnavailableResult(
      {
        code: 1,
        stderr: "'pnpm' is not recognized as an internal or external command.\r\n",
      },
      "pnpm",
      { platform: "win32" },
    ),
    true,
  );
});

test("package commands pin Windows x64", () => {
  for (const name of ["forge:package", "forge:make"]) {
    const command = packageManifest.scripts[name];
    assert.match(command, /--platform=win32/u);
    assert.match(command, /--arch=x64/u);
  }
  assert.doesNotMatch(JSON.stringify(packageManifest.scripts), /darwin|linux|arm64/iu);
});

test("Forge exposes only the Windows Squirrel maker", () => {
  assert.match(forgeSource, /new MakerSquirrel/u);
  assert.doesNotMatch(forgeSource, /MakerDMG|MakerDeb|MakerRpm|MakerZIP/u);
  assert.match(forgeSource, /platform !== "win32" \|\| arch !== "x64"/u);
  assert.match(forgeSource, /asar: true/u);
});

test("the packaged desktop owns its terminal native dependency", () => {
  assert.equal(packageManifest.dependencies["node-pty"], "1.2.0-beta.15");
  assert.match(viteMainSource, /external: \["sys", "node-pty"\]/u);
  assert.match(forgeSource, /join\(projectRoot, "node_modules", "node-pty"\)/u);
});

test("retired companion runtime is not packaged", () => {
  assert.doesNotMatch(forgeSource, /"companion-runtime"/u);
});

test("Forge runner rejects every target except Windows x64", () => {
  assert.match(
    forgeRunnerSource,
    /process\.platform !== "win32" \|\| process\.arch !== "x64"/u,
  );
  assert.match(forgeRunnerSource, /platform: "win32"/u);
  assert.match(forgeRunnerSource, /arch: "x64"/u);
  assert.doesNotMatch(forgeRunnerSource, /darwin|linux|arm64/iu);
});

test("packaged layout supports only MyDSH on Windows x64", () => {
  const layout = packagedApplicationLayout("C:\\project", "win32", "x64");
  assert.match(layout.outputRoot, /MyDSH-win32-x64$/u);
  assert.match(layout.executablePath, /MyDSH\.exe$/u);
  assert.throws(
    () => packagedApplicationLayout("C:\\project", "win32", "arm64"),
    /unsupported desktop target win32-arm64/u,
  );
  assert.throws(
    () => packagedApplicationLayout("C:\\project", "linux", "x64"),
    /unsupported desktop target linux-x64/u,
  );
});
