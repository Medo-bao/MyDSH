#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  harnessWebArguments,
  readHarnessRuntimeLayout,
} from "../../desktop/main/harness-launch.ts";
import { installFireflyPlugins } from "../../desktop/main/system-plugin-installer.ts";
import { packagedApplicationLayout } from "../forge/application-layout.mjs";
import {
  isCommandUnavailableResult,
  resolveCommandInvocation,
} from "./command-invocation.mjs";
import { verifyHarnessContract } from "./contract.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const smokeArguments = process.argv.slice(2);
const packaged = smokeArguments.includes("--packaged");
if (
  smokeArguments.some((argument) => argument !== "--packaged") ||
  smokeArguments.filter((argument) => argument === "--packaged").length > 1
) {
  throw new Error("usage: smoke.mjs [--packaged]");
}
const packagedLayout = packagedApplicationLayout(projectRoot);
const fixtureSource = join(projectRoot, "tests", "fixtures", "web-plugin");
const ptyProbePath = join(
  projectRoot,
  "scripts",
  "harness",
  "node-pty-probe.cjs",
);
const startupTimeoutMs = 90_000;
const hmrTimeoutMs = 15_000;

function systemPath() {
  if (process.platform === "win32") {
    return [
      process.env.SystemRoot === undefined
        ? undefined
        : join(process.env.SystemRoot, "System32"),
    ]
      .filter(Boolean)
      .join(delimiter);
  }
  return process.platform === "darwin"
    ? "/usr/bin:/bin:/usr/sbin:/sbin"
    : "/usr/bin:/bin";
}

function formatOutput(stdout, stderr) {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

async function run(command, args, options = {}) {
  return await new Promise((resolvePromise, reject) => {
    const invocation = resolveCommandInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolvePromise({ code, signal, stdout, stderr }),
    );
  });
}

async function runSuccessful(command, args, options = {}) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${basename(command)} ${args.join(" ")} failed ${
        result.signal === null
          ? `with exit code ${String(result.code)}`
          : `on ${result.signal}`
      }\n${formatOutput(result.stdout, result.stderr)}`,
    );
  }
  return result;
}

function parseManifest(html) {
  const match =
    /<script[^>]*>(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\])\s*=\s*(?<manifest>\{[\s\S]*?\})\s*;?\s*<\/script>/u.exec(html);
  if (match?.groups?.manifest === undefined) {
    throw new Error("served page has no window.__DSH_BOOT__ manifest");
  }
  const manifest = JSON.parse(match.groups.manifest);
  if (!Array.isArray(manifest.entries)) {
    throw new Error("served window.__DSH_BOOT__ manifest has no entries array");
  }
  return manifest;
}

async function fetchManifest(baseUrl) {
  const auth = await fetch(baseUrl, { redirect: "manual" });
  const cookie = auth.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  const response = auth.status === 303 && auth.headers.get("location") === "/"
    ? await fetch(new URL("/", baseUrl), { headers: { cookie }, redirect: "error" })
    : auth;
  if (!response.ok) {
    throw new Error(`GET / failed with HTTP ${String(response.status)}`);
  }
  return parseManifest(await response.text());
}

async function waitForChangedRevision(baseUrl, pluginId, initialRevision) {
  const deadline = Date.now() + hmrTimeoutMs;
  while (Date.now() < deadline) {
    const manifest = await fetchManifest(baseUrl);
    const row = manifest.entries.find((entry) => entry.id === pluginId);
    if (row?.rev !== undefined && row.rev !== initialRevision) return row;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(
    `external Web plugin revision did not change within ${String(hmrTimeoutMs)} ms`,
  );
}

async function startServer(
  nodeExecutable,
  entryPath,
  env,
) {
  const secret = randomBytes(32).toString("hex");
  const child = spawn(
    nodeExecutable,
    [entryPath, ...harnessWebArguments()],
    {
      cwd: projectRoot,
      detached: process.platform !== "win32",
      env: { ...env, FIREFLY_HARNESS_SECRET: secret },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let output = "";
  const diagnostics = () => output.replace(/([?&]token=)[^\s]*/gu, "$1[redacted]");
  let settled = false;

  const ready = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Harness did not become ready within ${String(startupTimeoutMs)} ms\n${diagnostics()}`,
        ),
      );
    }, startupTimeoutMs);
    const consume = (chunk) => {
      output += chunk;
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+(?:\/\?token=[A-Za-z0-9_-]+)?)[ \t]*\r?\n/u.exec(output);
      if (match?.[1] === undefined || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(match[1]);
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `Harness exited before readiness (code ${String(code)}, signal ${String(signal)})\n${diagnostics()}`,
        ),
      );
    });
  });

  try {
    const baseUrl = await ready;
    const url = new URL(baseUrl);
    const challenge = randomBytes(32).toString("hex");
    const response = await fetch(`${url.origin}/firefly-desktop-identity?challenge=${challenge}`, {
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    const proof = createHmac("sha256", secret).update(`${url.host}\n${challenge}`).digest("hex");
    if (!response.ok || (await response.json()).proof !== proof) throw new Error("Desktop identity challenge failed");
    return { baseUrl, child, output: diagnostics };
  } catch (error) {
    await stopServer(child);
    throw error;
  }
}

async function stopServer(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  const signal = (name) => {
    try {
      if (process.platform === "win32") child.kill(name);
      else process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolvePromise) =>
      child.once("exit", () => resolvePromise(true)),
    ),
    new Promise((resolvePromise) =>
      setTimeout(() => resolvePromise(false), 2_000),
    ),
  ]);
  if (!exited) signal("SIGKILL");
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(
      `Harness smoke requires win32-x64, received ${process.platform}-${process.arch}`,
    );
  }
  const verified = await verifyHarnessContract(projectRoot);
  const require = createRequire(import.meta.url);
  const electronExecutable = packaged
    ? packagedLayout.executablePath
    : require("electron");
  const runtimeLayout = await readHarnessRuntimeLayout();
  const entryPath = runtimeLayout.dshEntryPath;
  const nodeExecutable = runtimeLayout.nodeExecutable;
  const productPackageName = verified.productBundle.bundle.packageName;
  const resourceRoot = packaged
    ? packagedLayout.resourcesRoot
    : join(projectRoot, "resources");
  const productRoot = packaged
    ? join(resourceRoot, "harness-overlay")
    : join(projectRoot, "packages", "harness-overlay");
  const companionRoot = join(resourceRoot, "companion-plugins");
  const ptyRoot = packaged ? join(resourceRoot, "node-pty") : projectRoot;
  const rootManifest = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const dshManifest = JSON.parse(
    await readFile(join(runtimeLayout.dshPackageRoot, "package.json"), "utf8"),
  );
  if (dshManifest.version !== verified.contract.packageVersion) {
    throw new Error(
      `system dsh is ${JSON.stringify(dshManifest.version)}, expected ${JSON.stringify(verified.contract.packageVersion)}`,
    );
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-runtime-smoke-"));
  const harnessHome = join(temporaryRoot, "home");
  const negativeHome = join(temporaryRoot, "negative-home");
  const fixtureCopy = join(temporaryRoot, "web-plugin");
  const pluginId = "@dsh-desktop/smoke-web-plugin";
  const baseEnv = {
    ...process.env,
    DSH_ELECTRON_EXECUTABLE: electronExecutable,
  };
  const env = {
    ...baseEnv,
    DSH_HOME: harnessHome,
    PATH: process.env.PATH ?? systemPath(),
  };
  let server;

  try {
    if (!packaged) {
      await runSuccessful(
        process.execPath,
        [join(projectRoot, "scripts", "harness", "build-overlay.mjs")],
        { cwd: projectRoot, env: process.env },
      );
    }
    await installFireflyPlugins({
      appVersion:
        typeof rootManifest.version === "string" ? rootManifest.version : "0.0.0",
      companionRoot,
      dshHome: harnessHome,
      dshVersion: runtimeLayout.dshVersion,
      pnpmArguments: runtimeLayout.pnpmArguments,
      pnpmExecutable: runtimeLayout.pnpmExecutable,
      productRoot,
      statePath: join(harnessHome, "firefly-plugin-state.json"),
    });
    await cp(fixtureSource, fixtureCopy, { recursive: true });

    // Sensitivity check: the stock upstream installer must fail when our pnpm
    // adapter is removed from PATH. This proves the positive check exercises
    // the desktop adapter rather than an ambient developer installation.
    const negative = await run(
      nodeExecutable,
      [
        "--expose-internals",
        entryPath,
        "plugin",
        "--profile",
        "web",
        "add",
        fixtureCopy,
      ],
      {
        cwd: projectRoot,
        env: {
          ...baseEnv,
          DSH_HOME: negativeHome,
          PATH: systemPath(),
        },
      },
    );
    if (!isCommandUnavailableResult(negative, "pnpm")) {
      throw new Error(
        `negative control did not prove the pnpm seam (exit ${String(negative.code)})\n${formatOutput(negative.stdout, negative.stderr)}`,
      );
    }

    const nodeVersion = await runSuccessful(nodeExecutable, ["--version"], {
      cwd: projectRoot,
      env,
    });
    const pnpmVersion = await runSuccessful(
      runtimeLayout.pnpmExecutable,
      [...runtimeLayout.pnpmArguments, "--version"],
      {
      cwd: projectRoot,
      env,
      },
    );
    if (pnpmVersion.stdout.trim() !== verified.contract.pnpmVersion) {
      throw new Error(
        `system pnpm is ${JSON.stringify(pnpmVersion.stdout.trim())}, expected ${verified.contract.pnpmVersion}`,
      );
    }
    await runSuccessful(
      nodeExecutable,
      [ptyProbePath, ptyRoot],
      {
        cwd: projectRoot,
        env,
      },
    );

    await runSuccessful(
      nodeExecutable,
      [
        "--expose-internals",
        entryPath,
        "plugin",
        "--profile",
        "web",
        "add",
        fixtureCopy,
      ],
      { cwd: projectRoot, env },
    );

    server = await startServer(
      nodeExecutable,
      entryPath,
      env,
    );
    const manifest = await fetchManifest(server.baseUrl);
    const productRow = manifest.entries.find(
      (entry) => entry.id === productPackageName,
    );
    if (productRow === undefined) {
      throw new Error(
        `${productPackageName} is absent from the patched Web boot manifest`,
      );
    }
    if (process.env.FIREFLY_SMOKE_PLAYWRIGHT) {
      const { chromium } = createRequire(import.meta.url)(process.env.FIREFLY_SMOKE_PLAYWRIGHT);
      const browser = await chromium.launch({ channel: "msedge", headless: true });
      try {
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(server.baseUrl);
        await page.waitForTimeout(5000);
        if (errors.length) throw new Error(`Web client errors: ${errors.join("\n")}`);
        await page.screenshot({ path: join(projectRoot, "docs/research/alpha-web-smoke.png"), fullPage: true });
        console.log(`  browser UI: ${String((await page.locator("body").innerText()).slice(0, 500))}`);
      } finally { await browser.close(); }
    }
    const productClient = await fetch(
      new URL(productRow.url, server.baseUrl),
    );
    const productSource = productClient.ok
      ? await productClient.text()
      : "";
    if (
      !productClient.ok ||
      !productSource.includes("settings.open") ||
      !productSource.includes("session.new") ||
      !productSource.includes("locale/change")
    ) {
      throw new Error(`${productPackageName} client bundle was not served`);
    }

    const initialRow = manifest.entries.find((entry) => entry.id === pluginId);
    if (initialRow === undefined) {
      throw new Error(
        `external Web plugin is absent from ${String(manifest.entries.length)} boot entries`,
      );
    }

    const initialBundle = await fetch(new URL(initialRow.url, server.baseUrl));
    if (!initialBundle.ok || !(await initialBundle.text()).includes('"active"')) {
      throw new Error("external Web plugin initial bundle was not served");
    }

    const clientPath = join(fixtureCopy, "lib", "client.js");
    const initialSource = await readFile(clientPath, "utf8");
    await writeFile(clientPath, initialSource.replace('"active"', '"reloaded"'));
    const reloadedRow = await waitForChangedRevision(
      server.baseUrl,
      pluginId,
      initialRow.rev,
    );
    const reloadedBundle = await fetch(
      new URL(reloadedRow.url, server.baseUrl),
    );
    if (
      !reloadedBundle.ok ||
      !(await reloadedBundle.text()).includes('"reloaded"')
    ) {
      throw new Error("external Web plugin HMR bundle was not served");
    }

    console.log(
      [
        "Harness runtime smoke passed:",
        `  system Node:    ${nodeVersion.stdout.trim()}`,
        `  system pnpm:    ${pnpmVersion.stdout.trim()}`,
        `  ${packaged ? "packaged" : "project"} node-pty: functional`,
        `  Web plugins:   ${String(manifest.entries.length)}`,
        `  product overlay: ${productPackageName}`,
        `  external plugin install/load/HMR: ${new URL(server.baseUrl).origin}`,
        "  dsh/pnpm source: verified system installation",
        `  product resources: ${packaged ? "packaged application" : "workspace"}`,
      ].join("\n"),
    );
  } catch (error) {
    if (server !== undefined) {
      const output = server.output().trim();
      if (output !== "") console.error(output);
    }
    throw error;
  } finally {
    if (server !== undefined) await stopServer(server.child);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `harness:smoke: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
});
