import assert from "node:assert/strict";
import { delimiter, join } from "node:path";
import test from "node:test";
import { createServer } from "node:http";
import {
  commandCandidates,
  harnessWebArguments,
  parseMajorVersion,
  parseCmdShimTargets,
  SYSTEM_TOOL_REQUIREMENTS,
} from "@minke/desktop/main/harness-launch.ts";
import { harnessRuntimeEnvironment, verifyHarnessWebBoot } from "@minke/desktop/main/harness-runtime.ts";

test("Web boot health requires the Firefly manifest and rejects redirects", async () => {
  let content = '<script>globalThis["__DSH_BOOT__"] = {"entries":[{"id":"@firefly-harness/bundle-companion"}]};</script>';
  let status = 200;
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "text/html", location: "http://localhost/" });
    res.end(content);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await verifyHarnessWebBoot(url);
    content = '<script>window.__DSH_BOOT__ = {"entries":[]};</script>';
    await assert.rejects(verifyHarnessWebBoot(url), /missing the Firefly/);
    content = "unrelated server";
    await assert.rejects(verifyHarnessWebBoot(url), /manifest is missing/);
    status = 503;
    await assert.rejects(verifyHarnessWebBoot(url), /HTTP 503/);
    status = 302;
    await assert.rejects(verifyHarnessWebBoot(url));
    await assert.rejects(verifyHarnessWebBoot("https://example.com"), /unsafe readiness/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CMD shim inspection includes every lib/bin.js branch", () => {
  const shim = join(process.cwd(), "tools", "dsh.cmd");
  assert.deepEqual(parseCmdShimTargets(shim,
    'node "%~dp0../one/lib/bin.js"\nnode "%~dp0../two/lib/bin.js"'), [
    join(process.cwd(), "one", "lib", "bin.js"),
    join(process.cwd(), "two", "lib", "bin.js"),
  ]);
  assert.deepEqual(parseCmdShimTargets(shim, "unrecognized wrapper"), []);
});

test("Harness is launched through the system dsh command", () => {
  assert.deepEqual(harnessWebArguments(), [
    "web",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--no-open",
  ]);
  assert.equal(SYSTEM_TOOL_REQUIREMENTS.node, 24);
  assert.equal(SYSTEM_TOOL_REQUIREMENTS.pnpm, 11);
  assert.equal(SYSTEM_TOOL_REQUIREMENTS.python, 3);
});

test("system-tool discovery remains constrained to PATH executables", () => {
  const pathValue = ["C:\\Tools", "C:\\Program Files\\nodejs"].join(delimiter);
  assert.deepEqual(commandCandidates("node", pathValue), [
    join("C:\\Tools", "node.exe"),
    join("C:\\Program Files\\nodejs", "node.exe"),
  ]);
  assert.equal(parseMajorVersion("v24.19.0"), 24);
  assert.equal(parseMajorVersion("pnpm 11.7.0"), 11);
  assert.equal(parseMajorVersion("unknown"), undefined);
});

test("the desktop runtime preserves PATH and does not inject a bundled runtime", () => {
  const options = {
    dataRoot: "C:\\data\\harness",
    electronExecutable: "C:\\app\\MyDSH.exe",
    modelRuntimes: {
      lmStudio: { enabled: false, command: "C:\\Tools\\lms.exe" },
      ollama: { enabled: true, command: "C:\\Tools\\ollama.exe" },
    },
  };
  const inherited = {
    PATH: "C:\\Windows\\System32",
    DSH_PNPM_ENTRY: "C:\\stale\\pnpm.cjs",
    MINKE_LM_STUDIO_ENABLED: "1",
    MINKE_OLLAMA_ENABLED: "0",
    PRESERVED: "yes",
  };

  const environment = harnessRuntimeEnvironment(options, inherited);
  assert.equal(environment.PATH, inherited.PATH);
  assert.equal(environment.DSH_ELECTRON_EXECUTABLE, options.electronExecutable);
  assert.equal(environment.DSH_HOME, options.dataRoot);
  assert.equal(environment.DSH_PNPM_ENTRY, undefined);
  assert.equal(environment.MINKE_LM_STUDIO_ENABLED, "0");
  assert.equal(environment.MINKE_LM_STUDIO_COMMAND, options.modelRuntimes.lmStudio.command);
  assert.equal(environment.MINKE_OLLAMA_ENABLED, "1");
  assert.equal(environment.MINKE_OLLAMA_COMMAND, options.modelRuntimes.ollama.command);
  assert.equal(environment.PRESERVED, "yes");
});
