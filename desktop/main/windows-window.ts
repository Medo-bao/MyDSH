import type { BrowserWindowConstructorOptions } from "electron";

/** Windows glass; caption controls share the renderer's modal mask. */
export function windowsWindowOptions(
  platform: NodeJS.Platform = process.platform,
): Partial<BrowserWindowConstructorOptions> | undefined {
  if (platform !== "win32") return undefined;
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    backgroundColor: "#00000000",
    backgroundMaterial: "acrylic",
    autoHideMenuBar: true,
  };
}
