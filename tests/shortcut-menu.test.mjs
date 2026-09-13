import assert from "node:assert/strict";
import test from "node:test";
import {
  bindShortcutMenu,
  shortcutBindingToAccelerator,
} from "@minke/desktop/main/shortcut-menu.ts";
import { DesktopLocaleRuntime } from "@minke/desktop/i18n.ts";

const CUSTOM_PREFIX = "minke.shortcut.";

function menuItem(options) {
  return {
    id: options.id,
    type: options.type ?? (
      options.submenu === undefined ? "normal" : "submenu"
    ),
    label: options.label ?? "",
    accessibilityLabel: "",
    sublabel: "",
    toolTip: "",
    accelerator: options.accelerator ?? null,
    icon: undefined,
    enabled: options.enabled ?? true,
    visible: options.visible ?? true,
    checked: options.checked ?? false,
    registerAccelerator: options.registerAccelerator ?? true,
    sharingItem: undefined,
    role: options.role,
    click: options.click ?? (() => {}),
    submenu: options.submenu === undefined
      ? undefined
      : { items: options.submenu.map(menuItem) },
  };
}

function applicationMenu(items) {
  return { items: items.map(menuItem) };
}

function fakeMenuHost(initialMenu) {
  let current = initialMenu;
  const templates = [];
  return {
    templates,
    buildFromTemplate(template) {
      templates.push(template);
      return applicationMenu(template);
    },
    getApplicationMenu() {
      return current;
    },
    setApplicationMenu(menu) {
      current = menu;
    },
  };
}

function defaultMenu() {
  return applicationMenu([
    {
      role: "appMenu",
      label: "Minke",
      submenu: [
        { role: "about", label: "About Minke" },
        { type: "separator" },
        { role: "services", label: "Services" },
        { role: "quit", label: "Quit" },
      ],
    },
    {
      role: "fileMenu",
      label: "File",
      submenu: [{ role: "close", label: "Close" }],
    },
    {
      role: "editMenu",
      label: "Edit",
      submenu: [
        { role: "undo", label: "Undo" },
        { role: "redo", label: "Redo" },
        { type: "separator" },
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { role: "delete", label: "Delete" },
        { role: "selectAll", label: "Select All" },
      ],
    },
    {
      role: "viewMenu",
      label: "View",
      submenu: [
        { role: "reload", label: "Reload" },
        { role: "toggleDevTools", label: "Developer Tools" },
      ],
    },
    {
      role: "windowMenu",
      label: "Window",
      submenu: [{ role: "minimize", label: "Minimize" }],
    },
    {
      role: "help",
      label: "Help",
      submenu: [],
    },
  ]);
}

function walk(items) {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? walk(item.submenu) : []),
  ]);
}

function latestItems(host) {
  const template = host.templates.at(-1);
  assert.ok(template);
  return walk(template);
}

function customItem(host, suffix) {
  const item = latestItems(host).find(
    (candidate) => candidate.id === `${CUSTOM_PREFIX}${suffix}`,
  );
  assert.ok(item, `missing native menu item ${suffix}`);
  return item;
}

test("canonical shortcuts map to Electron accelerators", () => {
  assert.equal(
    shortcutBindingToAccelerator("Mod+S", "win32"),
    "CommandOrControl+S",
  );
  assert.equal(
    shortcutBindingToAccelerator("Mod+Shift+Comma", "win32"),
    "CommandOrControl+Shift+,",
  );
  assert.equal(
    shortcutBindingToAccelerator("Meta+ArrowLeft", "win32"),
    "Super+Left",
  );
  assert.equal(shortcutBindingToAccelerator(null, "win32"), undefined);
  assert.throws(
    () => shortcutBindingToAccelerator("S", "win32"),
    /invalid shortcut binding/u,
  );
});

test("all product shortcuts are visible native menu commands", () => {
  const host = fakeMenuHost(defaultMenu());
  const locale = new DesktopLocaleRuntime("en");
  const dispatched = [];
  const binding = bindShortcutMenu(
    host,
    locale,
    {},
    (id) => dispatched.push(id),
    "win32",
  );

  assert.equal(
    customItem(host, "settings.open").accelerator,
    "CommandOrControl+,",
  );
  assert.equal(
    customItem(host, "session.new").accelerator,
    "CommandOrControl+N",
  );
  assert.equal(
    customItem(host, "session.back").accelerator,
    "CommandOrControl+[",
  );
  assert.equal(
    customItem(host, "session.forward").accelerator,
    "CommandOrControl+]",
  );
  assert.equal(
    customItem(host, "sidebar.toggle").accelerator,
    "CommandOrControl+S",
  );
  assert.equal(
    customItem(host, "tabs.toggle").accelerator,
    "CommandOrControl+P",
  );
  assert.equal(
    customItem(host, "tabs.bottom.toggle").accelerator,
    "CommandOrControl+B",
  );

  customItem(host, "settings.open").click();
  customItem(host, "session.new").click();
  customItem(host, "session.back").click();
  customItem(host, "session.forward").click();
  customItem(host, "sidebar.toggle").click();
  customItem(host, "tabs.toggle").click();
  customItem(host, "tabs.bottom.toggle").click();
  assert.deepEqual(dispatched, [
    "settings.open",
    "session.new",
    "session.back",
    "session.forward",
    "sidebar.toggle",
    "tabs.toggle",
    "tabs.bottom.toggle",
  ]);
  binding.dispose();
});

test("persisted and localized changes rebuild menu accelerators", () => {
  const host = fakeMenuHost(defaultMenu());
  const locale = new DesktopLocaleRuntime("en");
  const binding = bindShortcutMenu(
    host,
    locale,
    {},
    () => {},
    "win32",
  );

  binding.updateBindings({
    "session.new": "",
    "sidebar.toggle": "Mod+Shift+S",
  });
  assert.equal(
    Object.hasOwn(customItem(host, "session.new"), "accelerator"),
    false,
  );
  assert.equal(
    customItem(host, "sidebar.toggle").accelerator,
    "CommandOrControl+Shift+S",
  );

  locale.setLocale("zh");
  const localized = latestItems(host);
  const labelForRole = (role) => {
    const item = localized.find((candidate) => candidate.role === role);
    assert.ok(item, `missing role menu item ${role}`);
    return item.label;
  };
  assert.deepEqual(
    host.templates.at(-1).map((item) => item.label),
    ["Minke", "文件", "编辑", "视图", "窗口", "帮助"],
  );
  assert.equal(labelForRole("about"), "关于 MyDSH");
  assert.equal(labelForRole("undo"), "撤销");
  assert.equal(labelForRole("redo"), "重做");
  assert.equal(labelForRole("cut"), "剪切");
  assert.equal(labelForRole("copy"), "复制");
  assert.equal(labelForRole("paste"), "粘贴");
  assert.equal(labelForRole("delete"), "删除");
  assert.equal(labelForRole("selectAll"), "全选");
  assert.equal(labelForRole("close"), "关闭窗口");
  assert.equal(labelForRole("reload"), "重新加载");
  assert.equal(labelForRole("toggleDevTools"), "开发者工具");
  assert.equal(labelForRole("minimize"), "最小化");
  assert.equal(customItem(host, "settings.open").label, "设置…");
  assert.equal(customItem(host, "session.new").label, "新建会话");
  assert.equal(customItem(host, "session.back").label, "返回上一会话");
  assert.equal(customItem(host, "session.forward").label, "前往下一会话");
  assert.equal(
    customItem(host, "sidebar.toggle").label,
    "展开或折叠左侧栏",
  );
  assert.equal(
    customItem(host, "tabs.toggle").label,
    "展开或折叠右侧栏",
  );
  assert.equal(
    customItem(host, "tabs.bottom.toggle").label,
    "展开或折叠底部栏",
  );

  binding.refreshBaseMenu();
  assert.equal(
    latestItems(host).filter(
      (item) => item.id?.startsWith(CUSTOM_PREFIX),
    ).filter((item) => item.type !== "separator").length,
    7,
  );

  const rebuilds = host.templates.length;
  binding.dispose();
  locale.setLocale("en");
  assert.equal(host.templates.length, rebuilds);
});
