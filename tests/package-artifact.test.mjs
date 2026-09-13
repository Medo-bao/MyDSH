import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  parsePackageArtifactPolicy,
  verifyPackagedApplication,
} from "../scripts/forge/package-artifact.ts";

const productPackageName = "@firefly-harness/bundle-companion";

function verificationOptions(overrides = {}) {
  return {
    appSizeBudgetBytes: 1024 * 1024,
    arch: "x64",
    platform: "win32",
    productPackageName,
    runtimeFileBudget: 100,
    runtimeSizeBudgetBytes: 1024 * 1024,
    ...overrides,
  };
}

async function write(path, contents = "fixture") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function withPackagedApp(callback) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "firefly-package-artifact-"));
  const appRoot = join(temporaryRoot, "MyDSH-win32-x64");
  const resourcesRoot = join(appRoot, "resources");
  const productRoot = join(resourcesRoot, "harness-overlay");
  const companionRoot = join(resourcesRoot, "companion-plugins", "firefly-test");
  try {
    await Promise.all([
      write(join(appRoot, "MyDSH.exe")),
      write(join(resourcesRoot, "app.asar")),
      write(join(productRoot, "package.json"), "{}\n"),
      write(join(productRoot, "lib", "index.js")),
      write(join(productRoot, "lib", "client.js")),
      write(join(productRoot, "companion.contract.json"), "{}\n"),
      write(join(companionRoot, "package.json"), "{}\n"),
    ]);
    await callback({ appRoot, resourcesRoot });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("the final package gate accepts desktop and plugin resources only", async () => {
  await withPackagedApp(async ({ appRoot }) => {
    const report = await verifyPackagedApplication(appRoot, verificationOptions());
    assert.ok(report.app.bytes > report.host.bytes);
    assert.ok(report.host.files > 0);
  });
});

test("the final package gate rejects embedded system runtimes", async () => {
  await withPackagedApp(async ({ appRoot, resourcesRoot }) => {
    for (const forbidden of ["host", "node", "node.exe", "pnpm", "dsh"]) {
      await write(join(resourcesRoot, forbidden, "payload.bin"));
      await assert.rejects(
        verifyPackagedApplication(appRoot, verificationOptions()),
        /contains forbidden path/u,
      );
      await rm(join(resourcesRoot, forbidden), { recursive: true, force: true });
    }
  });
});

test("the final package gate rejects non-Windows-x64 targets", async () => {
  await withPackagedApp(async ({ appRoot }) => {
    await assert.rejects(
      verifyPackagedApplication(appRoot, verificationOptions({ arch: "arm64" })),
      /unsupported packaged application target win32-arm64/u,
    );
    await assert.rejects(
      verifyPackagedApplication(appRoot, verificationOptions({ platform: "linux" })),
      /unsupported packaged application target linux-x64/u,
    );
  });
});

test("package artifact policy permits only a positive win32 budget", () => {
  const policy = { schemaVersion: 1, appSizeBudgetBytes: { win32: 671088640 } };
  assert.deepEqual(parsePackageArtifactPolicy(policy), policy);
  assert.throws(
    () => parsePackageArtifactPolicy({
      schemaVersion: 1,
      appSizeBudgetBytes: { win32: 671088640, linux: 1 },
    }),
    /must only declare win32/u,
  );
});
