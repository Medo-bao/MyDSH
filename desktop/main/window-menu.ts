import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
  Menu,
} from "electron";
import {
  parseWindowMenuPopupRequest,
  WINDOW_MENU_POPUP_CHANNEL,
  type WindowMenuKind,
} from "@minke/desktop/window-menu-contract";

type MenuPort = Readonly<{
  getApplicationMenu(): Menu | null;
}>;

const MENU_LABEL_KEYS: Record<WindowMenuKind, string> = {
  file: "menu.file",
  edit: "menu.edit",
  view: "menu.view",
  help: "menu.help",
};

export type WindowMenuBinding = Readonly<{ dispose(): void }>;

export function bindWindowMenuPopup(
  ipcMain: Pick<IpcMain, "handle" | "removeHandler">,
  menu: MenuPort,
  window: BrowserWindow,
  authorize: (event: IpcMainInvokeEvent) => boolean,
  translate: (key: string) => string,
): WindowMenuBinding {
  ipcMain.handle(WINDOW_MENU_POPUP_CHANNEL, (event, candidate) => {
    if (!authorize(event)) throw new Error("unauthorized window menu request");
    const request = parseWindowMenuPopupRequest(candidate);
    const label = translate(MENU_LABEL_KEYS[request.kind]);
    const item = menu.getApplicationMenu()?.items.find(
      (candidate) => candidate.label === label,
    );
    if (item?.submenu === undefined || item.submenu === null) {
      throw new Error(`window menu ${request.kind} is unavailable`);
    }
    item.submenu.popup({ window, x: request.x, y: request.y });
  });
  return Object.freeze({
    dispose() {
      ipcMain.removeHandler(WINDOW_MENU_POPUP_CHANNEL);
    },
  });
}
