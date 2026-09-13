import assert from "node:assert/strict";
import test from "node:test";
import {
  bindWindowMenuPopup,
} from "../desktop/main/window-menu.ts";
import {
  WINDOW_MENU_POPUP_CHANNEL,
} from "../desktop/window-menu-contract.ts";

function fixture({ authorized = true } = {}) {
  const handlers = new Map();
  const popups = [];
  const submenu = {
    popup(options) {
      popups.push(options);
    },
  };
  const menu = {
    getApplicationMenu() {
      return { items: [{ label: "文件", submenu }] };
    },
  };
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const window = { id: 1 };
  const binding = bindWindowMenuPopup(
    ipcMain,
    menu,
    window,
    () => authorized,
    (key) => key === "menu.file" ? "文件" : key,
  );
  return { binding, handlers, popups, window };
}

test("desktop toolbar opens the matching application submenu", async () => {
  const { handlers, popups, window } = fixture();
  await handlers.get(WINDOW_MENU_POPUP_CHANNEL)(
    {},
    { kind: "file", x: 80, y: 44 },
  );
  assert.deepEqual(popups, [{ window, x: 80, y: 44 }]);
});

test("window menu popup rejects untrusted and malformed requests", async () => {
  const unauthorized = fixture({ authorized: false });
  await assert.rejects(
    async () => unauthorized.handlers.get(WINDOW_MENU_POPUP_CHANNEL)(
        {},
        { kind: "file", x: 0, y: 44 },
      ),
    /unauthorized/u,
  );
  const malformed = fixture();
  await assert.rejects(
    async () => malformed.handlers.get(WINDOW_MENU_POPUP_CHANNEL)(
        {},
        { kind: "other", x: -1, y: 44 },
      ),
    /invalid window menu/u,
  );
  assert.equal(malformed.popups.length, 0);
});

test("disposing the window menu bridge removes its IPC handler", () => {
  const { binding, handlers } = fixture();
  binding.dispose();
  assert.equal(handlers.has(WINDOW_MENU_POPUP_CHANNEL), false);
});
