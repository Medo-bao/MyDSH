import type { BrowserWindowConstructorOptions } from "electron";
import { windowTitleBarOverlay } from "./window-theme.ts";

/** Native Windows 11 glass with system-owned caption controls. */
export function windowsWindowOptions(
  platform: NodeJS.Platform = process.platform,
): Partial<BrowserWindowConstructorOptions> | undefined {
  if (platform !== "win32") return undefined;
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: windowTitleBarOverlay("light"),
    backgroundColor: "#00000000",
    backgroundMaterial: "acrylic",
    autoHideMenuBar: true,
  };
}
