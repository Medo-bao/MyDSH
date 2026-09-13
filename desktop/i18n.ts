import type { DesktopLocale } from "./locale-contract.ts";

const zh = {
  "bootstrap.loading": "正在启动 MyDSH",
  "runtime.exitCode": "退出码：{value}",
  "runtime.signal": "信号：{value}",
  "runtime.stoppedTitle": "DeepSeek Harness 已停止",
  "runtime.stoppedMessage": "本地 Harness 进程意外退出。",
  "runtime.restart": "重新启动",
  "runtime.quit": "退出 MyDSH",
  "runtime.restartFailedTitle": "无法重新启动 DeepSeek Harness",
  "runtime.startupFailedTitle": "MyDSH 启动失败",
  "menu.file": "文件",
  "menu.edit": "编辑",
  "menu.view": "视图",
  "menu.window": "窗口",
  "menu.help": "帮助",
  "menu.about": "关于 MyDSH",
  "menu.services": "服务",
  "menu.hide": "隐藏 MyDSH",
  "menu.hideOthers": "隐藏其他窗口",
  "menu.unhide": "全部显示",
  "menu.quit": "退出 MyDSH",
  "menu.undo": "撤销",
  "menu.redo": "重做",
  "menu.cut": "剪切",
  "menu.copy": "复制",
  "menu.paste": "粘贴",
  "menu.pasteAndMatchStyle": "粘贴并匹配样式",
  "menu.delete": "删除",
  "menu.selectAll": "全选",
  "menu.speech": "语音",
  "menu.startSpeaking": "开始朗读",
  "menu.stopSpeaking": "停止朗读",
  "menu.close": "关闭窗口",
  "menu.reload": "重新加载",
  "menu.forceReload": "强制重新加载",
  "menu.toggleDevTools": "开发者工具",
  "menu.resetZoom": "实际大小",
  "menu.zoomIn": "放大",
  "menu.zoomOut": "缩小",
  "menu.toggleFullScreen": "切换全屏",
  "menu.minimize": "最小化",
  "menu.zoom": "缩放",
  "menu.front": "前置所有窗口",
  "tray.show": "显示 MyDSH",
  "tray.updateClient": "检查客户端更新…",
  "tray.quit": "退出",
  "update.latestTitle": "已是最新版本",
  "update.clientLatest": "当前桌面客户端已是最新版本。",
  "update.unavailableTitle": "更新源未配置",
  "update.sourcesMissing": "请通过 DSH_DESKTOP_GITHUB_RELEASE_API 和 DSH_DESKTOP_GITEE_RELEASE_API 配置客户端更新源。",
  "workspace.authorize": "选择允许 Firefly 打开和还原文件的工作区",
  "update.clientTitle": "桌面客户端更新",
  "update.clientAvailable": "发现桌面客户端 {version}。",
  "update.clientSource": "更新来源：{source}。下载失败时会自动尝试备用源。",
  "update.installRestart": "安装并重启",
  "update.downloadInstall": "下载并安装",
  "update.later": "稍后",
  "update.ok": "确定",
  "update.failedTitle": "更新失败",
  "update.failedMessage": "未对当前可用版本进行更改。",
  "menu.settings": "设置…",
  "menu.newSession": "新建会话",
  "menu.sessionBack": "返回上一会话",
  "menu.sessionForward": "前往下一会话",
  "menu.toggleSidebar": "展开或折叠左侧栏",
  "menu.toggleRightSidebar": "展开或折叠右侧栏",
  "menu.toggleBottomPanel": "展开或折叠底部栏",
  "sessionExport.saveDialogTitle": "导出 Session 日志",
  "sessionExport.zipFilter": "ZIP 归档",
  "sessionExport.failedTitle": "无法导出 Session 日志",
  "sessionExport.failedMessage": "Session 日志导出失败。",
  "sessionExport.ok": "确定",
} as const;

export type DesktopMessageKey = keyof typeof zh;

const en: Record<DesktopMessageKey, string> = {
  "bootstrap.loading": "Starting MyDSH",
  "runtime.exitCode": "Exit code: {value}",
  "runtime.signal": "Signal: {value}",
  "runtime.stoppedTitle": "DeepSeek Harness stopped",
  "runtime.stoppedMessage":
    "The local Harness process exited unexpectedly.",
  "runtime.restart": "Restart",
  "runtime.quit": "Quit MyDSH",
  "runtime.restartFailedTitle":
    "Unable to restart DeepSeek Harness",
  "runtime.startupFailedTitle": "MyDSH failed to start",
  "menu.file": "File",
  "menu.edit": "Edit",
  "menu.view": "View",
  "menu.window": "Window",
  "menu.help": "Help",
  "menu.about": "About MyDSH",
  "menu.services": "Services",
  "menu.hide": "Hide MyDSH",
  "menu.hideOthers": "Hide Others",
  "menu.unhide": "Show All",
  "menu.quit": "Quit MyDSH",
  "menu.undo": "Undo",
  "menu.redo": "Redo",
  "menu.cut": "Cut",
  "menu.copy": "Copy",
  "menu.paste": "Paste",
  "menu.pasteAndMatchStyle": "Paste and Match Style",
  "menu.delete": "Delete",
  "menu.selectAll": "Select All",
  "menu.speech": "Speech",
  "menu.startSpeaking": "Start Speaking",
  "menu.stopSpeaking": "Stop Speaking",
  "menu.close": "Close Window",
  "menu.reload": "Reload",
  "menu.forceReload": "Force Reload",
  "menu.toggleDevTools": "Developer Tools",
  "menu.resetZoom": "Actual Size",
  "menu.zoomIn": "Zoom In",
  "menu.zoomOut": "Zoom Out",
  "menu.toggleFullScreen": "Toggle Full Screen",
  "menu.minimize": "Minimize",
  "menu.zoom": "Zoom",
  "menu.front": "Bring All to Front",
  "tray.show": "Show MyDSH",
  "tray.updateClient": "Check for Desktop Updates…",
  "tray.quit": "Quit",
  "update.latestTitle": "Up to date",
  "update.clientLatest": "The desktop client is up to date.",
  "update.unavailableTitle": "Update sources not configured",
  "update.sourcesMissing": "Configure desktop sources with DSH_DESKTOP_GITHUB_RELEASE_API and DSH_DESKTOP_GITEE_RELEASE_API.",
  "workspace.authorize": "Choose a workspace where Firefly may open and restore files",
  "update.clientTitle": "Desktop Update",
  "update.clientAvailable": "Desktop client {version} is available.",
  "update.clientSource": "Source: {source}. A backup source is tried if the download fails.",
  "update.installRestart": "Install and Restart",
  "update.downloadInstall": "Download and Install",
  "update.later": "Later",
  "update.ok": "OK",
  "update.failedTitle": "Update failed",
  "update.failedMessage": "The currently working version was left unchanged.",
  "menu.settings": "Settings…",
  "menu.newSession": "New Session",
  "menu.sessionBack": "Back to Previous Session",
  "menu.sessionForward": "Forward to Next Session",
  "menu.toggleSidebar": "Toggle Sidebar",
  "menu.toggleRightSidebar": "Toggle Right Sidebar",
  "menu.toggleBottomPanel": "Toggle Bottom Panel",
  "sessionExport.saveDialogTitle": "Export Session log",
  "sessionExport.zipFilter": "ZIP archives",
  "sessionExport.failedTitle": "Unable to export Session log",
  "sessionExport.failedMessage":
    "The Session log could not be exported.",
  "sessionExport.ok": "OK",
};

export const desktopDictionaries = Object.freeze({
  zh: Object.freeze(zh),
  en: Object.freeze(en),
});

export type DesktopTranslateParams = Readonly<
  Record<string, unknown>
>;

/** Translate one desktop-owned native string using Harness-compatible braces. */
export function translateDesktop(
  locale: DesktopLocale,
  key: DesktopMessageKey,
  params?: DesktopTranslateParams,
): string {
  const template = desktopDictionaries[locale][key];
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    params !== undefined && Object.hasOwn(params, name)
      ? String(params[name])
      : match,
  );
}

export type DesktopLocaleSnapshot = Readonly<{
  active: DesktopLocale;
  revision: number;
}>;

/** In-memory desktop projection of Harness's authoritative active locale. */
export class DesktopLocaleRuntime {
  #snapshot: DesktopLocaleSnapshot;
  readonly #listeners = new Set<() => void>();

  constructor(initial: DesktopLocale) {
    this.#snapshot = Object.freeze({
      active: initial,
      revision: 0,
    });
  }

  getSnapshot(): DesktopLocaleSnapshot {
    return this.#snapshot;
  }

  setLocale(locale: DesktopLocale): void {
    if (locale === this.#snapshot.active) return;
    this.#snapshot = Object.freeze({
      active: locale,
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  t(
    key: DesktopMessageKey,
    params?: DesktopTranslateParams,
  ): string {
    return translateDesktop(this.#snapshot.active, key, params);
  }
}
