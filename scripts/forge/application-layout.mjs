import { join } from "node:path";

const applicationName = "MyDSH";

export function applicationResourcesRoot(appRoot, platform) {
  if (platform !== "win32") throw new Error(`unsupported platform ${platform}`);
  return join(appRoot, "resources");
}

export function applicationExecutablePath(appRoot, platform) {
  if (platform !== "win32") throw new Error(`unsupported platform ${platform}`);
  return join(appRoot, `${applicationName}.exe`);
}

export function packagedApplicationLayout(
  projectRoot,
  platform = process.platform,
  arch = process.arch,
) {
  const outputRoot = join(
    projectRoot,
    "out",
    `${applicationName}-${platform}-${arch}`,
  );
  if (platform !== "win32" || arch !== "x64") {
    throw new Error(`unsupported desktop target ${platform}-${arch}`);
  }
  const appRoot = outputRoot;
  return {
    appRoot,
    executablePath: applicationExecutablePath(appRoot, platform),
    outputRoot,
    resourcesRoot: applicationResourcesRoot(appRoot, platform),
  };
}
