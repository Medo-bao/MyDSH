import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  bindWindowTheme,
  windowTitleBarOverlay,
} from "@minke/desktop/main/window-theme.ts";
import { WINDOW_THEME_CHANNEL } from "@minke/desktop/window-theme-contract.ts";
import {
  windowsWindowOptions,
} from "@minke/desktop/main/windows-window.ts";

function fixture() {
  const ipc = new EventEmitter();
  const nativeTheme = { themeSource: "system" };
  const binding = bindWindowTheme({ webContents: { ipc } }, nativeTheme);
  return { binding, ipc, nativeTheme };
}

test("renderer caption mode never re-enables native caption buttons on theme changes", () => {
  const ipc = new EventEmitter();
  const nativeTheme = { themeSource: "system" };
  const binding = bindWindowTheme({ webContents: { ipc }, setTitleBarOverlay: () => assert.fail("Native captions must stay disabled") }, nativeTheme, false);
  ipc.emit(WINDOW_THEME_CHANNEL, {}, { preference: "dark", colorScheme: "dark" });
  assert.equal(nativeTheme.themeSource, "dark");
  binding.dispose();
});

test("explicit renderer themes update the native window appearance", () => {
  const { binding, ipc, nativeTheme } = fixture();

  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "dark",
    colorScheme: "dark",
  });
  assert.equal(nativeTheme.themeSource, "dark");

  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "light",
    colorScheme: "light",
  });
  assert.equal(nativeTheme.themeSource, "light");
  binding.dispose();
});

test("native title-bar controls stay legible in both color schemes", () => {
  assert.deepEqual(windowTitleBarOverlay("light"), {
    color: "#00000000",
    height: 44,
    symbolColor: "#454b55",
  });
  assert.deepEqual(windowTitleBarOverlay("dark"), {
    color: "#00000000",
    height: 44,
    symbolColor: "#d9dde3",
  });

  const ipc = new EventEmitter();
  const overlays = [];
  const binding = bindWindowTheme(
    {
      setTitleBarOverlay(options) {
        overlays.push(options);
      },
      webContents: { ipc },
    },
    { themeSource: "system" },
  );
  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "dark",
    colorScheme: "dark",
  });
  assert.deepEqual(overlays, [windowTitleBarOverlay("dark")]);
  binding.dispose();
});

test("Windows reserves a dedicated native caption surface", () => {
  assert.deepEqual(windowsWindowOptions("linux"), undefined);
  assert.deepEqual(windowsWindowOptions("win32"), {
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    backgroundColor: "#00000000",
    backgroundMaterial: "acrylic",
    autoHideMenuBar: true,
  });
});

test("system preference leaves native chrome connected to the OS", () => {
  const { binding, ipc, nativeTheme } = fixture();

  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "system",
    colorScheme: "dark",
  });
  assert.equal(nativeTheme.themeSource, "system");
  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "system",
    colorScheme: "light",
  });

  assert.equal(nativeTheme.themeSource, "system");
  binding.dispose();
});

test("early resolved schemes cover pre-plugin theme bootstrap", () => {
  const { binding, ipc, nativeTheme } = fixture();

  ipc.emit(WINDOW_THEME_CHANNEL, {}, { colorScheme: "dark" });
  assert.equal(nativeTheme.themeSource, "dark");
  ipc.emit(WINDOW_THEME_CHANNEL, {}, { colorScheme: "light" });
  assert.equal(nativeTheme.themeSource, "light");
  binding.dispose();
});

test("invalid renderer messages cannot change the native appearance", () => {
  const { binding, ipc, nativeTheme } = fixture();

  for (const message of [
    null,
    { colorScheme: "sepia" },
    {},
    { colorScheme: "dark", extra: true },
    { preference: "system", colorScheme: "dark", extra: true },
    { preference: "light", colorScheme: "dark" },
    { preference: "sepia", colorScheme: "dark" },
  ]) {
    ipc.emit(WINDOW_THEME_CHANNEL, {}, message);
  }

  assert.equal(nativeTheme.themeSource, "system");
  binding.dispose();
});

test("disposing the binding stops later renderer updates", () => {
  const { binding, ipc, nativeTheme } = fixture();

  binding.dispose();
  binding.dispose();
  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "dark",
    colorScheme: "dark",
  });

  assert.equal(nativeTheme.themeSource, "system");
  assert.equal(ipc.listenerCount(WINDOW_THEME_CHANNEL), 0);
});

test("theme binding can dispose after its BrowserWindow is destroyed", () => {
  const ipc = new EventEmitter();
  let destroyed = false;
  const window = {
    get webContents() {
      if (destroyed) throw new TypeError("Object has been destroyed");
      return { ipc };
    },
  };
  const binding = bindWindowTheme(
    window,
    { themeSource: "system" },
  );

  destroyed = true;
  assert.doesNotThrow(() => binding.dispose());
  assert.equal(ipc.listenerCount(WINDOW_THEME_CHANNEL), 0);
});
