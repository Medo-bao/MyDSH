import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type SaveDialogOptions,
  type WebContents,
} from "electron";
import started from "electron-squirrel-startup";
import { MarketManager } from "./market-manager";
import { bindMarketManagement } from "./market-ipc";
import { join, parse } from "node:path";
import {
  DesktopLocaleRuntime,
  translateDesktop,
  type DesktopMessageKey,
  type DesktopTranslateParams,
} from "@minke/desktop/i18n";
import {
  resolveDesktopLocale,
  type DesktopLocale,
} from "@minke/desktop/locale-contract";
import {
  TABS_WEB_PARTITION,
} from "@minke/harness-overlay/tabs/contract";
import {
  SHORTCUT_INVOKE_CHANNEL,
  type ProductShortcutActionId,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract";
import { configureAppDataPaths } from "./app-data-paths";
import type { DesktopDetails } from "@minke/harness-overlay/market-contract.ts";
import {
  HarnessRuntime,
  type HarnessRuntimeExit,
} from "./harness-runtime";
import { readHarnessRuntimeLayout } from "./harness-launch";
import { installFireflyPlugins } from "./system-plugin-installer";
import { createStatefulMainWindow } from "./main-window-state";
import {
  minkeConfigFilePath,
  MinkeConfigStore,
} from "./minke-config";
import {
  discoverLocalModelCommands,
} from "./local-model-command";
import {
  bindModelRuntimeSettingsIpc,
  type ModelRuntimeSettingsBinding,
} from "./model-runtime-settings";
import { bindMainWindowDevToolsShortcut } from "./main-window-devtools";
import { isInternalNavigation } from "./navigation-policy";
import {
  bindShortcutMenu,
  type ShortcutMenuBinding,
} from "./shortcut-menu";
import {
  bindShortcutSettingsIpc,
  type ShortcutSettingsBinding,
} from "./shortcut-settings";
import {
  bindTerminalSettingsIpc,
  type TerminalSettingsBinding,
} from "./terminal-settings";
import {
  bindSessionLogExport,
  type SessionLogExportBinding,
} from "./session-export";
import {
  bindTabs,
  type TabsBinding,
} from "./tabs";
import { bindWindowLocale } from "./window-locale";
import { bindWindowTheme } from "./window-theme";
import { windowsWindowOptions } from "./windows-window";
import {
  bindWindowMenuPopup,
  type WindowMenuBinding,
} from "./window-menu";
import { SessionCompletionWatcher } from "./session-completion-watcher";
import {
  startMainProcessWatchdog,
  type MainProcessWatchdog,
} from "./watchdog";
import { healWindowsShortcuts } from "./shortcut-healer";
import { requestApplicationQuit } from "./application-quit";
import {
  ClientUpdater,
  configuredClientUpdateSources,
} from "./client-updater";

const PRODUCT_NAME = "MyDSH";
const BACKGROUND_COLOR = "#0b1220";

let mainWindow: BrowserWindow | undefined;
let marketManager: MarketManager | undefined;
let marketQuitPending = false;
let runtime: HarnessRuntime | undefined;
let harnessUrl: string | undefined;
let quitting = false;
let shutdownStarted = false;
let recovering = false;
let shortcutMenuBinding: ShortcutMenuBinding | undefined;
let shortcutSettingsBinding: ShortcutSettingsBinding | undefined;
let terminalSettingsBinding: TerminalSettingsBinding | undefined;
let modelRuntimeSettingsBinding:
  | ModelRuntimeSettingsBinding
  | undefined;
let sessionLogExportBinding: SessionLogExportBinding | undefined;
let tabsBinding: TabsBinding | undefined;
let desktopLocale: DesktopLocaleRuntime | undefined;
let appTray: Tray | undefined;
let disposeTrayLocale: (() => void) | undefined;
let sessionCompletionWatcher: SessionCompletionWatcher | undefined;
let mainProcessWatchdog: MainProcessWatchdog | undefined;
let clientUpdater: ClientUpdater | undefined;
let windowMenuBinding: WindowMenuBinding | undefined;
let updateTimers: NodeJS.Timeout[] = [];
let clientUpdateBusy = false;
let runningHarnessVersion = "";
let clientUpdateController: AbortController | undefined;
let clientUpdateStatus: Pick<DesktopDetails, "updatePhase" | "updatePercent" | "updateError"> = { updatePhase: "idle" };

function activeDesktopLocale(): DesktopLocale {
  return desktopLocale?.getSnapshot().active ?? "en";
}

function desktopText(
  key: DesktopMessageKey,
  params?: DesktopTranslateParams,
): string {
  return desktopLocale?.t(key, params) ??
    translateDesktop("en", key, params);
}

function sessionExportSaveDialogOptions(
  suggestedFilename: string,
): SaveDialogOptions {
  return {
    title: desktopText("sessionExport.saveDialogTitle"),
    defaultPath: join(
      app.getPath("downloads"),
      suggestedFilename,
    ),
    filters: [
      {
        name: desktopText("sessionExport.zipFilter"),
        extensions: ["zip"],
      },
    ],
    properties: [
      "createDirectory",
      "showOverwriteConfirmation",
    ],
  };
}

function bootstrapUrl(): string | undefined {
  return MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined;
}

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "resources", "icons", "icon.png");
}

function showMainWindow(): void {
  if (mainWindow === undefined) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function productPluginRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "harness-overlay")
    : join(app.getAppPath(), "packages", "harness-overlay");
}

function companionPluginRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "companion-plugins")
    : join(app.getAppPath(), "resources", "companion-plugins");
}

function terminalPtyRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "node-pty")
    : join(app.getAppPath(), "node_modules", "node-pty");
}

function trayIconPath(): string {
  return appIconPath();
}

function installTray(): void {
  if (appTray !== undefined) return;
  const image = nativeImage.createFromPath(trayIconPath());
  if (image.isEmpty()) {
    console.error("Unable to create system tray: application icon is empty");
    return;
  }
  appTray = new Tray(image.resize({ width: 20, height: 20 }));
  appTray.setToolTip(PRODUCT_NAME);
  appTray.on("click", showMainWindow);

  const rebuildMenu = (): void => {
    appTray?.setContextMenu(Menu.buildFromTemplate([
      {
        label: desktopText("tray.show"),
        click: showMainWindow,
      },
      { type: "separator" },
      {
        label: desktopText("tray.updateClient"),
        click: () => void checkClientUpdate(true),
      },
      { type: "separator" },
      {
        label: desktopText("tray.quit"),
        click: () => {
          if (marketManager?.installing) {
            marketManager.cancel();
            void marketManager.whenIdle().then(() => requestApplicationQuit(app));
          }
          else requestApplicationQuit(app);
        },
      },
    ]));
  };
  rebuildMenu();
  disposeTrayLocale = desktopLocale?.subscribe(rebuildMenu);
}

function showCompletionNotification(
  completion: Readonly<{ title: string; body: string }>,
): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: completion.title,
    body: completion.body,
    icon: appIconPath(),
  });
  notification.on("click", showMainWindow);
  notification.show();
}

async function invokeShortcutAction(
  id: ProductShortcutActionId,
): Promise<void> {
  const window = mainWindow ?? await createWindow();
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  if (
    harnessUrl !== undefined &&
    !isHarnessUrl(window.webContents.getURL())
  ) {
    await window.loadURL(harnessUrl);
  }
  if (!isHarnessUrl(window.webContents.getURL())) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send(SHORTCUT_INVOKE_CHANNEL, id);
}

async function loadBootstrap(window: BrowserWindow): Promise<void> {
  const developmentUrl = bootstrapUrl();
  if (developmentUrl !== undefined) {
    const url = new URL(developmentUrl);
    url.searchParams.set("locale", activeDesktopLocale());
    await window.loadURL(url.toString());
    return;
  }
  await window.loadFile(
    join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    {
      query: { locale: activeDesktopLocale() },
    },
  );
}

function isHarnessUrl(value: string): boolean {
  if (harnessUrl === undefined) return false;
  try {
    const url = new URL(value);
    return url.origin === harnessUrl && url.pathname === "/";
  } catch {
    return false;
  }
}

function canOpenExternally(value: string): boolean {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function protectNavigation(webContents: WebContents): void {
  webContents.on("will-navigate", (details) => {
    if (
      isInternalNavigation(
        details.url,
        [bootstrapUrl(), harnessUrl],
      )
    ) {
      return;
    }
    details.preventDefault();
    if (canOpenExternally(details.url)) {
      void shell.openExternal(details.url);
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (isHarnessUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          backgroundColor: BACKGROUND_COLOR,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    }
    if (canOpenExternally(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const window = createStatefulMainWindow(
    minkeConfigFilePath(app.getPath("userData")),
    (bounds) => new BrowserWindow({
      title: PRODUCT_NAME,
      icon: appIconPath(),
      ...bounds,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: BACKGROUND_COLOR,
      ...windowsWindowOptions(),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, "desktop-preload.js"),
        sandbox: true,
        webSecurity: true,
        webviewTag: true,
      },
    }),
  );
  window.setMenuBarVisibility(false);
  bindMainWindowDevToolsShortcut(Menu);
  const windowTheme = bindWindowTheme(window, nativeTheme);
  const localeRuntime = desktopLocale;
  if (localeRuntime === undefined) {
    throw new Error("desktop locale was not initialized");
  }
  const windowLocale = bindWindowLocale(
    window,
    localeRuntime,
    (candidate) => {
      const event = candidate as IpcMainEvent;
      return (
        event.sender === window.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
  );
  mainWindow = window;
  marketManager = new MarketManager(join(app.getPath("userData"), "harness"));
  const marketBinding = bindMarketManagement(ipcMain,
    marketManager,
    (event) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isHarnessUrl(event.senderFrame.url),
    () => { app.relaunch(); app.quit(); },
    {
      info: async () => ({ version: app.getVersion(), harnessVersion: runningHarnessVersion,
        electronVersion: process.versions.electron, platform: `${process.platform} ${process.arch}`, updateBusy: clientUpdateBusy, ...clientUpdateStatus }),
      update: () => checkClientUpdate(true),
      cancel: () => clientUpdateController?.abort(),
    },
  );
  shortcutMenuBinding?.refreshBaseMenu();
  windowMenuBinding?.dispose();
  windowMenuBinding = bindWindowMenuPopup(
    ipcMain,
    Menu,
    window,
    (candidate) => (
      candidate.sender === window.webContents &&
      candidate.senderFrame !== null &&
      isHarnessUrl(candidate.senderFrame.url)
    ),
    (key) => desktopText(key as DesktopMessageKey),
  );
  protectNavigation(window.webContents);
  tabsBinding = bindTabs(
    ipcMain,
    window.webContents,
    shell,
    (candidate) => (
      candidate.sender === window.webContents &&
      candidate.senderFrame !== null &&
      isHarnessUrl(candidate.senderFrame.url)
    ),
    {
      runtimeRoot: terminalPtyRoot(),
      defaultCwd: app.getPath("home"),
      fileSystemRoot: parse(app.getPath("home")).root,
    },
  );
  sessionLogExportBinding = bindSessionLogExport(
    ipcMain,
    window.webContents.session,
    window.webContents,
    shell,
    {
      authorize: (candidate) => (
        candidate.sender === window.webContents &&
        candidate.senderFrame !== null &&
        isHarnessUrl(candidate.senderFrame.url)
      ),
      harnessUrl: () => harnessUrl,
      async chooseDestination(suggestedFilename) {
        const result = await dialog.showSaveDialog(
          window,
          sessionExportSaveDialogOptions(suggestedFilename),
        );
        return result.canceled || result.filePath === ""
          ? undefined
          : result.filePath;
      },
      saveDialogOptions: sessionExportSaveDialogOptions,
      reportError(error) {
        void dialog
          .showMessageBox(window, {
            type: "error",
            title: desktopText("sessionExport.failedTitle"),
            message: desktopText("sessionExport.failedMessage"),
            detail: error.message,
            buttons: [desktopText("sessionExport.ok")],
            defaultId: 0,
            noLink: true,
          })
          .catch((dialogError: unknown) => {
            console.error(
              "Unable to show Session export error:",
              dialogError,
            );
          });
      },
    },
  );
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => {
    marketBinding.dispose();
    windowMenuBinding?.dispose();
    windowMenuBinding = undefined;
    sessionLogExportBinding?.dispose();
    sessionLogExportBinding = undefined;
    tabsBinding?.dispose();
    tabsBinding = undefined;
    windowLocale.dispose();
    windowTheme.dispose();
    if (mainWindow === window) mainWindow = undefined;
  });

  await loadBootstrap(window);
  if (harnessUrl !== undefined) await window.loadURL(harnessUrl);
  return window;
}

function installPermissionPolicy(): void {
  const allows = (value: string | undefined) =>
    value !== undefined && isHarnessUrl(value);

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, _permission, requestingOrigin, details) =>
      allows(details.requestingUrl ?? requestingOrigin),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback, details) =>
      callback(allows(details.requestingUrl)),
  );

  const tabsWebSession = session.fromPartition(
    TABS_WEB_PARTITION,
  );
  tabsWebSession.setPermissionCheckHandler(() => false);
  tabsWebSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}

async function startHarness(): Promise<void> {
  const activeRuntime = runtime;
  const window = mainWindow;
  if (activeRuntime === undefined || window === undefined) return;
  await prepareHarnessPlugins();
  harnessUrl = await activeRuntime.start();
  const launchUrl = harnessUrl;
  harnessUrl = new URL(launchUrl).origin;
  await window.loadURL(launchUrl);
}

async function prepareHarnessPlugins(): Promise<void> {
  const systemRuntime = await readHarnessRuntimeLayout();
  runningHarnessVersion = systemRuntime.dshVersion;
  const dshHome = join(app.getPath("userData"), "harness");
  await installFireflyPlugins({
    appVersion: app.getVersion(), companionRoot: companionPluginRoot(), dshHome,
    dshVersion: systemRuntime.dshVersion, pnpmArguments: systemRuntime.pnpmArguments,
    pnpmExecutable: systemRuntime.pnpmExecutable, productRoot: productPluginRoot(),
    statePath: join(dshHome, "firefly-plugin-state.json"),
  });
}

async function handleUnexpectedExit(exit: HarnessRuntimeExit): Promise<void> {
  if (quitting || recovering) return;
  recovering = true;
  harnessUrl = undefined;
  console.error("Harness runtime exited unexpectedly:", exit);

  try {
    if (mainWindow !== undefined) await loadBootstrap(mainWindow);
    const detail = [
      desktopText("runtime.exitCode", {
        value: String(exit.code),
      }),
      desktopText("runtime.signal", {
        value: String(exit.signal),
      }),
      "",
      exit.output.slice(-4_000),
    ].join("\n");
    const result = await dialog.showMessageBox({
      type: "error",
      title: desktopText("runtime.stoppedTitle"),
      message: desktopText("runtime.stoppedMessage"),
      detail,
      buttons: [
        desktopText("runtime.restart"),
        desktopText("runtime.quit"),
      ],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) {
      await startHarness();
    } else {
      app.quit();
    }
  } catch (error) {
    dialog.showErrorBox(
      desktopText("runtime.restartFailedTitle"),
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    app.quit();
  } finally {
    recovering = false;
  }
}

async function checkClientUpdate(manual: boolean): Promise<void> {
  if (clientUpdateBusy || clientUpdater === undefined) return;
  clientUpdateBusy = true;
  clientUpdateController = new AbortController();
  const signal = clientUpdateController.signal;
  clientUpdateStatus = { updatePhase: "checking" };
  let accepted = false;
  try {
    if (!clientUpdater.enabled) {
      if (manual) await showUpdateMessage("update.unavailableTitle", "update.sourcesMissing");
      return;
    }
    const update = await clientUpdater.check(signal);
    if (update === undefined) {
      clientUpdateStatus = { updatePhase: "current" };
      if (manual) await showUpdateMessage("update.latestTitle", "update.clientLatest");
      return;
    }
    clientUpdateStatus = { updatePhase: "prompt" };
    const result = await dialog.showMessageBox({
      type: "info",
      title: desktopText("update.clientTitle"),
      message: desktopText("update.clientAvailable", { version: update.version }),
      detail: desktopText("update.clientSource", { source: update.source.name }),
      buttons: [desktopText("update.downloadInstall"), desktopText("update.later")],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0) { clientUpdateStatus = { updatePhase: "idle" }; return; }
    signal.throwIfAborted();
    accepted = true;
    const installer = await clientUpdater.download(update, { signal, progress: (phase, percent) => {
      clientUpdateStatus = { updatePhase: phase, updatePercent: percent };
      mainWindow?.setProgressBar(percent === undefined ? 2 : percent / 100);
    } });
    signal.throwIfAborted();
    clientUpdateStatus = { updatePhase: "installing" };
    await clientUpdater.launchInstaller(installer);
    mainProcessWatchdog?.markCleanExit();
    app.quit();
  } catch (error) {
    if (error === signal.reason && signal.aborted) { clientUpdateStatus = { updatePhase: "cancelled" }; return; }
    clientUpdateStatus = { updatePhase: "failed", updateError: error instanceof Error ? error.message : String(error) };
    if (manual || accepted) await showUpdateError(error);
    else console.error("Automatic desktop update check failed:", error);
  } finally {
    clientUpdateBusy = false;
    clientUpdateController = undefined;
    if (clientUpdateStatus.updatePhase === "checking") clientUpdateStatus = { updatePhase: "idle" };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
  }
}

async function showUpdateMessage(title: DesktopMessageKey, message: DesktopMessageKey): Promise<void> {
  await dialog.showMessageBox({
    type: "info",
    title: desktopText(title),
    message: desktopText(message),
    buttons: [desktopText("update.ok")],
    defaultId: 0,
    noLink: true,
  });
}

async function showUpdateError(error: unknown): Promise<void> {
  await dialog.showMessageBox({
    type: "error",
    title: desktopText("update.failedTitle"),
    message: desktopText("update.failedMessage"),
    detail: error instanceof Error ? error.message : String(error),
    buttons: [desktopText("update.ok")],
    defaultId: 0,
    noLink: true,
  });
}

function scheduleAutomaticUpdates(): void {
  if (!app.isPackaged) return;
  const schedule = (delay: number, interval: number, task: () => Promise<void>): void => {
    const first = setTimeout(() => {
      void task();
      const repeating = setInterval(() => void task(), interval);
      repeating.unref();
      updateTimers.push(repeating);
    }, delay);
    first.unref();
    updateTimers.push(first);
  };
  schedule(60_000, 12 * 60 * 60 * 1_000, () => checkClientUpdate(false));
}

async function bootstrap(): Promise<void> {
  app.setName(PRODUCT_NAME);
  configureAppDataPaths(app);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    showMainWindow();
  });

  await app.whenReady();
  desktopLocale = new DesktopLocaleRuntime(resolveDesktopLocale(app.getLocale()));
  const systemRuntime = await readHarnessRuntimeLayout();
  const dshHome = join(app.getPath("userData"), "harness");
  mainProcessWatchdog = startMainProcessWatchdog({
    nodeExecutable: systemRuntime.nodeExecutable,
    resourcesPath: app.isPackaged
      ? process.resourcesPath
      : join(app.getAppPath(), "resources"),
    executable: process.execPath,
  });
  installPermissionPolicy();
  const minkeConfig = new MinkeConfigStore(app.getPath("userData"));
  const shortcutStore = minkeConfig.shortcuts;
  const terminalSettingsStore = minkeConfig.terminal;
  const modelRuntimeSettingsStore = minkeConfig.modelRuntime;
  const localModelCommands = await discoverLocalModelCommands({
    homeDirectory: app.getPath("home"),
    pathValue: process.env.PATH,
    platform: process.platform,
    ...(process.env.LOCALAPPDATA === undefined
      ? {}
      : { localAppData: process.env.LOCALAPPDATA }),
  });
  const modelRuntimeAvailability = {
    lmStudio: localModelCommands.lmStudio !== undefined,
    ollama: localModelCommands.ollama !== undefined,
  };
  let shortcutBindings: ShortcutBindings = {};
  let modelRuntimeSettings = {
    lmStudio: { enabled: false },
    ollama: { enabled: false },
  };
  try {
    shortcutBindings = await shortcutStore.read();
  } catch (error) {
    console.error("Unable to read native shortcut menu settings:", error);
  }
  try {
    modelRuntimeSettings = await modelRuntimeSettingsStore.read();
  } catch (error) {
    console.error("Unable to read model runtime settings:", error);
  }
  await createWindow();
  installTray();
  await healWindowsShortcuts(
    app,
    shell,
    process.execPath,
    PRODUCT_NAME,
  ).catch((error: unknown) => {
    console.error("Unable to heal Windows shortcuts:", error);
  });
  shortcutMenuBinding = bindShortcutMenu(
    Menu,
    desktopLocale,
    shortcutBindings,
    (id) => {
      void invokeShortcutAction(id);
    },
  );
  shortcutSettingsBinding = bindShortcutSettingsIpc(
    ipcMain,
    shortcutStore,
    (candidate) => {
      const event = candidate as IpcMainInvokeEvent;
      return (
        mainWindow !== undefined &&
        event.sender === mainWindow.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
    (bindings) => shortcutMenuBinding?.updateBindings(bindings),
  );
  terminalSettingsBinding = bindTerminalSettingsIpc(
    ipcMain,
    terminalSettingsStore,
    (candidate) => {
      const event = candidate as IpcMainInvokeEvent;
      return (
        mainWindow !== undefined &&
        event.sender === mainWindow.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
  );
  modelRuntimeSettingsBinding = bindModelRuntimeSettingsIpc(
    ipcMain,
    modelRuntimeSettingsStore,
    modelRuntimeAvailability,
    (candidate) => {
      const event = candidate as IpcMainInvokeEvent;
      return (
        mainWindow !== undefined &&
        event.sender === mainWindow.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
  );

  clientUpdater = new ClientUpdater({
    currentVersion: app.getVersion(),
    updatesRoot: join(app.getPath("userData"), "updates", "client"),
    sources: configuredClientUpdateSources(process.env),
  });
  runtime = new HarnessRuntime({
    dshEntryPath: systemRuntime.dshEntryPath,
    resolveEntryPath: async () => (await readHarnessRuntimeLayout()).dshEntryPath,
    nodeExecutable: systemRuntime.nodeExecutable,
    dataRoot: dshHome,
    electronExecutable: process.execPath,
    modelRuntimes: {
      lmStudio: {
        enabled:
          modelRuntimeSettings.lmStudio.enabled &&
          modelRuntimeAvailability.lmStudio,
        ...(localModelCommands.lmStudio === undefined
          ? {}
          : { command: localModelCommands.lmStudio }),
      },
      ollama: {
        enabled:
          modelRuntimeSettings.ollama.enabled &&
          modelRuntimeAvailability.ollama,
        ...(localModelCommands.ollama === undefined
          ? {}
          : { command: localModelCommands.ollama }),
      },
    },
    onUnexpectedExit: (exit) => void handleUnexpectedExit(exit),
  });
  await startHarness();
  sessionCompletionWatcher = new SessionCompletionWatcher(
    join(app.getPath("userData"), "harness", "sessions"),
    showCompletionNotification,
  );
  sessionCompletionWatcher.start();
  scheduleAutomaticUpdates();

  app.on("activate", () => {
    showMainWindow();
  });
}

app.on("before-quit", (event) => {
  clientUpdateController?.abort();
  if (marketManager?.installing) {
    marketManager.cancel();
    event.preventDefault();
    if (!marketQuitPending) {
      marketQuitPending = true;
      void marketManager.whenIdle().then(() => { marketQuitPending = false; app.quit(); });
    }
    return;
  }
  quitting = true;
  sessionCompletionWatcher?.stop();
  sessionCompletionWatcher = undefined;
  for (const timer of updateTimers) clearTimeout(timer);
  updateTimers = [];
  disposeTrayLocale?.();
  disposeTrayLocale = undefined;
  appTray?.destroy();
  appTray = undefined;
  mainProcessWatchdog?.markCleanExit();
  mainProcessWatchdog = undefined;
  shortcutMenuBinding?.dispose();
  shortcutMenuBinding = undefined;
  shortcutSettingsBinding?.dispose();
  shortcutSettingsBinding = undefined;
  terminalSettingsBinding?.dispose();
  terminalSettingsBinding = undefined;
  modelRuntimeSettingsBinding?.dispose();
  modelRuntimeSettingsBinding = undefined;
  windowMenuBinding?.dispose();
  windowMenuBinding = undefined;
  if (shutdownStarted || runtime === undefined) return;
  event.preventDefault();
  shutdownStarted = true;
  void runtime.stop().finally(() => app.quit());
});

app.on("window-all-closed", () => app.quit());

if (started) {
  app.quit();
} else {
  void bootstrap().catch(async (error) => {
    console.error("MyDSH startup failed:", error);
    try {
      await app.whenReady();
      const result = await dialog.showMessageBox({ type: "error", title: desktopText("runtime.startupFailedTitle"),
        message: desktopText("runtime.startupHelp"), detail: error instanceof Error ? error.message : String(error),
        buttons: [desktopText("runtime.restart"), desktopText("runtime.setupGuide"), desktopText("runtime.quit")],
        defaultId: 0, cancelId: 2, noLink: true });
      if (result.response === 0) app.relaunch();
      if (result.response === 1) await shell.openExternal("https://github.com/Medo-bao/MyDSH#readme");
    } catch (dialogError) { console.error("Unable to show startup recovery:", dialogError); }
    finally { app.quit(); }
  });
}
