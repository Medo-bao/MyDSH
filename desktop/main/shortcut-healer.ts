import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { App, Shell } from "electron";

type ShortcutShell = Pick<Shell, "readShortcutLink" | "writeShortcutLink">;
type ShortcutApp = Pick<App, "getPath" | "isPackaged">;

export async function healWindowsShortcuts(
  app: ShortcutApp,
  shell: ShortcutShell,
  executable: string,
  productName: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== "win32" || !app.isPackaged) return;
  const startMenuDirectory = join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
  await mkdir(startMenuDirectory, { recursive: true });
  const paths = [
    join(app.getPath("desktop"), `${productName}.lnk`),
    join(startMenuDirectory, `${productName}.lnk`),
  ];
  for (const path of paths) {
    let target: string | undefined;
    try {
      target = shell.readShortcutLink(path).target;
    } catch {
      // Missing and malformed shortcuts are both replaced below.
    }
    if (target?.toLowerCase() === executable.toLowerCase()) continue;
    const operation = target === undefined ? "create" : "update";
    const written = shell.writeShortcutLink(path, operation, {
      target: executable,
      cwd: app.getPath("home"),
      description: productName,
      icon: executable,
      iconIndex: 0,
    });
    if (!written) throw new Error(`Unable to ${operation} shortcut ${path}`);
  }
}
