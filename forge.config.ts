import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parsePackageArtifactPolicy,
  verifyPackagedApplication,
} from "./scripts/forge/package-artifact.ts";

const projectRoot = __dirname;
const iconRoot = join(projectRoot, "resources", "icons");
const appIcon = join(iconRoot, "icon.png");

function logPackageStage(
  platform: string,
  arch: string,
  stage: string,
): void {
  console.log(`[packager:${platform}-${arch}] ${stage}`);
}

const config: ForgeConfig = {
  hooks: {
    postPackage: async (
      _forgeConfig,
      { arch, outputPaths, platform },
    ) => {
      if (platform !== "win32" || arch !== "x64") {
        throw new Error(`unsupported desktop target ${platform}-${String(arch)}`);
      }
      const [runtimeContract, artifactPolicy] = await Promise.all([
        readFile(
          join(projectRoot, "config", "harness-runtime.json"),
          "utf8",
        ).then(JSON.parse),
        readFile(
          join(projectRoot, "config", "package-artifact.json"),
          "utf8",
        ).then(JSON.parse).then(parsePackageArtifactPolicy),
      ]);
      for (const outputPath of outputPaths) {
        const report = await verifyPackagedApplication(outputPath, {
          appSizeBudgetBytes:
            artifactPolicy.appSizeBudgetBytes[platform],
          arch: String(arch),
          platform,
          productPackageName:
            runtimeContract.productBundle.packageName,
          runtimeFileBudget: runtimeContract.runtimeFileBudget,
          runtimeSizeBudgetBytes:
            runtimeContract.runtimeSizeBudgetBytes[platform],
        });
        console.log(
          `Verified packaged plugins ${(report.host.bytes / 1024 / 1024).toFixed(1)} MiB/${String(report.host.files)} files and app ${(report.app.bytes / 1024 / 1024).toFixed(1)} MiB`,
        );
      }
    },
  },
  packagerConfig: {
    name: "MyDSH",
    executableName: "MyDSH",
    appBundleId: "ai.firefly.harness",
    asar: true,
    // The Vite plugin copies only .vite. Packager pruning would otherwise walk
    // the complete pnpm graph before that ignore policy.
    prune: false,
    icon: join(iconRoot, "icon"),
    afterCopy: [
      (
        _buildPath,
        _electronVersion,
        platform,
        arch,
        callback,
      ) => {
        logPackageStage(
          platform,
          String(arch),
          "native dependencies ready",
        );
        callback();
      },
    ],
    beforeAsar: [
      (
        _buildPath,
        _electronVersion,
        platform,
        arch,
        callback,
      ) => {
        logPackageStage(platform, String(arch), "asar started");
        callback();
      },
    ],
    afterAsar: [
      (
        _buildPath,
        _electronVersion,
        platform,
        arch,
        callback,
      ) => {
        logPackageStage(platform, String(arch), "asar completed");
        callback();
      },
    ],
    beforeCopyExtraResources: [
      (
        _buildPath,
        _electronVersion,
        platform,
        arch,
        callback,
      ) => {
        logPackageStage(
          platform,
          String(arch),
          "extra resources started",
        );
        callback();
      },
    ],
    afterCopyExtraResources: [
      (_buildPath, _electronVersion, platform, arch, callback) => {
        logPackageStage(platform, String(arch), "extra resources completed");
        callback();
      },
    ],
    afterComplete: [
      (
        _buildPath,
        _electronVersion,
        platform,
        arch,
        callback,
      ) => {
        logPackageStage(
          platform,
          String(arch),
          "package completed",
        );
        callback();
      },
    ],
    extraResource: [
      join(projectRoot, "packages", "harness-overlay"),
      join(projectRoot, "resources", "companion-plugins"),
      join(projectRoot, "resources", "licenses"),
      appIcon,
      join(projectRoot, "resources", "watchdog.mjs"),
      join(projectRoot, "node_modules", "node-pty"),
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "MyDSH",
      setupIcon: join(iconRoot, "icon.ico"),
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "desktop/main/main.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "desktop/preload/desktop-preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      // Every language runtime and toolchain is resolved from the system.
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
