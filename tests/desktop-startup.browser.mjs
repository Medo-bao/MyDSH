import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const child = spawn(resolve("out/MyDSH-win32-x64/MyDSH.exe"), [
  `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1",
], { stdio: "ignore", windowsHide: true });
let browser;
try {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Desktop exited before startup");
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 });
      break;
    } catch { await delay(1000); }
  }
  assert.ok(browser, "Desktop debugging endpoint did not start");
  let loaded;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!/^http:\/\/127\.0\.0\.1:\d+\//u.test(page.url())) continue;
        if ((await page.locator("body").innerText()).trim().length < 20) continue;
        loaded = page;
      }
    }
    if (loaded) break;
    assert.equal(child.exitCode, null, "Desktop exited before Harness navigation");
    await delay(1000);
  }
  assert.ok(loaded, "Desktop did not reach the Harness UI within 180 seconds");
  await loaded.locator("[data-dsh-desktop-toolbar]").waitFor();
  assert.equal(await loaded.locator("[data-minke-about-trigger]").count(), 0, "Retired About popup must not be mounted");
  const deferSetup = loaded.getByRole("button", { name: "稍后配置", exact: true });
  await deferSetup.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await deferSetup.isVisible()) await deferSetup.click();
  const originallyCollapsed = await loaded.locator("[data-sidebar-collapsed]").count() > 0;
  const sidebarToggle = loaded.locator("[data-dsh-desktop-sidebar-toggle]");
  const customSidebar = process.env.MYDSH_TEST_CUSTOM_SIDEBAR === "1";
  if (customSidebar) {
    console.log("SKIP upstream sidebar geometry: explicitly testing a user theme with a custom sidebar");
  } else {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 960, height: 640 }]) {
    await loaded.setViewportSize(viewport);
    if (await loaded.locator("[data-sidebar-collapsed]").count()) {
      await sidebarToggle.click();
      await loaded.locator("[data-sidebar-collapsed]").waitFor({ state: "detached" });
    }
    await sidebarToggle.click();
    await loaded.locator("[data-sidebar-collapsed]").waitFor();
    for (const hovered of [false, true]) {
      if (hovered) await sidebarToggle.hover();
      else await loaded.mouse.move(viewport.width - 20, viewport.height - 20);
      await loaded.waitForFunction(() => {
        const anchor = document.querySelector("[data-dsh-desktop-titlebar-anchor]");
        const button = document.querySelector("[data-dsh-desktop-sidebar-toggle]");
        const session = document.querySelector("[data-dsh-desktop-new-session]");
        if (!anchor || !button || !session) return false;
        const rail = anchor.parentElement;
        if (rail.getAnimations({ subtree: true }).some((animation) =>
          animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity)) return false;
        const center = (element) => { const r = element.getBoundingClientRect(); return r.x + r.width / 2; };
        const style = getComputedStyle(anchor);
        const glyph = [...button.querySelectorAll("img, svg")].find((element) => element.getBoundingClientRect().width > 0);
        return style.paddingLeft === "0px" && style.paddingRight === "0px"
          && Math.abs(center(button) - center(rail)) < 1
          && Math.abs(center(button) - center(session)) < 0.5
          && glyph && Math.abs(center(glyph) - center(session)) < 0.5;
      }, null, { timeout: 5000 });
      await loaded.screenshot({ path: `docs/research/sidebar-${viewport.width}-${hovered ? "hover" : "rest"}.png` });
    }
  }
  if (!originallyCollapsed) {
    await sidebarToggle.click();
    await loaded.locator("[data-sidebar-collapsed]").waitFor({ state: "detached" });
  }
  }
  for (const viewport of [{ width: 1280, height: 800 }, { width: 960, height: 640 }]) {
    await loaded.setViewportSize(viewport);
    const geometry = await loaded.evaluate(() => {
      const root = document.querySelector("#root");
      const bounds = root.getBoundingClientRect();
      const arrows = [...document.querySelectorAll(".firefly-desktop-toolbar__arrow")].map((button) => {
        const a = button.getBoundingClientRect();
        const b = button.firstElementChild.getBoundingClientRect();
        return { dx: Math.abs(a.x + a.width / 2 - b.x - b.width / 2), dy: Math.abs(a.y + a.height / 2 - b.y - b.height / 2) };
      });
      const probe = document.createElement("div");
      probe.style.height = "2000px";
      root.append(probe);
      const result = { top: bounds.top, bottom: bounds.bottom, viewport: innerHeight,
        outerOverflow: document.documentElement.scrollHeight - innerHeight,
        innerOverflow: root.scrollHeight > root.clientHeight, arrows };
      probe.remove();
      return result;
    });
    assert.equal(geometry.top, 44);
    assert.equal(geometry.bottom, geometry.viewport);
    assert.equal(geometry.outerOverflow, 0);
    assert.equal(geometry.innerOverflow, true);
    assert.equal(geometry.arrows.length, 2);
    for (const arrow of geometry.arrows) assert.ok(arrow.dx < 0.5 && arrow.dy < 0.5);
  }
  await loaded.screenshot({ path: "docs/research/desktop-startup-fixed.png" });
  await loaded.locator('[data-slot="sidebar.settings"] button[aria-haspopup="dialog"][aria-expanded]').first().click();
  await loaded.getByRole("button", { name: "插件", exact: true }).waitFor();
  await loaded.waitForFunction(() => [...document.querySelectorAll(".mydsh-caption-controls button")].length === 3
    && [...document.querySelectorAll(".mydsh-caption-controls button")].every(button => button.disabled));
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 1280, height: 800 }, { width: 960, height: 640 }]) {
    await loaded.setViewportSize(viewport);
    const bounds = await loaded.getByRole("dialog", { name: "设置", exact: true }).boundingBox();
    assert.ok(bounds, "Settings panel must be visible");
    assert.ok(bounds.y >= 68, `Settings top must clear the caption and keep its margin: ${bounds.y}`);
    assert.ok(bounds.y + bounds.height <= viewport.height - 24, "Settings bottom must keep its margin");
    const horizontalMargin = customSidebar ? 0 : 24;
    assert.ok(bounds.x >= horizontalMargin && bounds.x + bounds.width <= viewport.width - horizontalMargin,
      `Settings must fit within the viewport: ${JSON.stringify(bounds)}`);
  }
  const mask = await loaded.evaluate(() => {
    const toolbar = document.querySelector("[data-dsh-desktop-toolbar]");
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    const upstream = dialog.parentElement.querySelector('[aria-hidden="true"]');
    const actual = getComputedStyle(toolbar, "::after");
    const expected = getComputedStyle(upstream);
    return { content: actual.content, blur: actual.backdropFilter, background: actual.backgroundColor,
      expectedBlur: expected.backdropFilter, expectedBackground: expected.backgroundColor };
  });
  assert.equal(mask.content, '\"\"');
  assert.notEqual(mask.blur, "none");
  if (!customSidebar) {
    assert.equal(mask.blur, mask.expectedBlur);
    assert.equal(mask.background, mask.expectedBackground);
  } else {
    console.log("Custom theme mask audit (upstream visual equality not required):", mask);
  }
  assert.equal(await loaded.locator("[data-firefly-brand-name]").count(), 0);
  assert.equal(await loaded.locator("[data-dsh-desktop-toolbar]").evaluate((element) => getComputedStyle(element).borderBottomWidth), "0px");
  for (const name of ["内置插件", "余额", "自定义提示词", "对话调整", "视觉", "侧边会话"]) {
    assert.equal(await loaded.getByRole("button", { name, exact: true }).count(), 0, `Retired settings remain: ${name}`);
  }
  assert.equal(await loaded.evaluate(() => "dshDesktop" in window), false);
  assert.ok(await loaded.locator("[data-firefly-brand-mark]").count());
  await loaded.screenshot({ path: "docs/research/no-optional-plugins-settings.png" });
  await loaded.screenshot({ path: "docs/research/settings-titlebar-blur.png" });
  await loaded.getByRole("navigation").getByRole("button", { name: "关于 MyDSH", exact: true }).click();
  await loaded.getByText("DeepSeek Harness 版本", { exact: true }).waitFor();
  await loaded.getByRole("button", { name: "检查软件更新", exact: true }).waitFor();
  const management = loaded.locator(".firefly-market-management");
  assert.equal(await management.getByRole("link", { name: "MyDSH", exact: true }).getAttribute("href"), "https://github.com/Medo-bao/MyDSH");
  assert.equal(await management.getByRole("link", { name: "DeepSeek Harness", exact: true }).getAttribute("href"), "https://github.com/deepseek-ai/deepseek-harness");
  await management.getByRole("button", { name: "检测更新", exact: true }).click();
  await loaded.waitForFunction(() => {
    const section = document.querySelector(".firefly-market-management");
    return /^\d+\.\d+\.\d+/u.test([...section.querySelectorAll("dd")].at(-1)?.textContent ?? "") || section.querySelector('[role="alert"]');
  }, null, { timeout: 25_000 });
  await management.locator("dd").first().filter({ hasText: "0.0.4" }).waitFor({ timeout: 30_000 });
  await management.locator("dd").nth(1).filter({ hasText: /^\d+\.\d+\.\d+/u }).waitFor({ timeout: 5000 });
  await management.locator("dd").nth(2).filter({ hasText: /^\d+\.\d+\.\d+/u }).waitFor({ timeout: 5000 });
  assert.equal(await management.getByRole("link", { name: "GitHub 仓库" }).getAttribute("href"), "https://github.com/dsh-market/dsh-market");
  assert.equal(await management.getByRole("button", { name: /安装最新版|更新插件市场|已是最新版本/u }).count(), 1);
  if (await management.getByRole("alert").count()) {
    const error = await management.getByRole("alert").textContent();
    assert.match(error, /fetch failed|network|timeout|timed out|abort|HTTP 5\d\d/iu, "Only external registry availability can be skipped");
    console.log("Market registry unavailable; verified visible error state:", error);
  }
  const closeSelect = management.getByRole("combobox", { name: "关闭窗口时" });
  await closeSelect.waitFor();
  const originalClose = await closeSelect.inputValue();
  try {
    await closeSelect.selectOption("tray");
    await loaded.waitForFunction(async () => (await window.minkeDesktop.market.info()).closeBehavior === "tray");
    await loaded.getByRole("button", { name: "通用设置", exact: true }).click();
    await loaded.getByRole("navigation").getByRole("button", { name: "关于 MyDSH", exact: true }).click();
    await loaded.waitForFunction(() => document.querySelector("#mydsh-close-behavior")?.value === "tray");
  } finally { await loaded.evaluate(value => window.minkeDesktop.market.setCloseBehavior(value), originalClose); }
  await loaded.screenshot({ path: "docs/research/market-management.png" });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 960, height: 640 }]) {
    await loaded.setViewportSize(viewport);
    assert.equal(await management.evaluate(element => element.scrollWidth > element.clientWidth), false, "About content must not overflow horizontally");
    await management.getByRole("link", { name: "GitHub 仓库" }).scrollIntoViewIfNeeded();
    await loaded.screenshot({ path: `docs/research/about-mydsh-${viewport.width}.png` });
  }
  await loaded.getByRole("button", { name: "通用设置", exact: true }).click();
  await loaded.getByRole("navigation").getByRole("button", { name: "关于 MyDSH", exact: true }).click();
  await management.locator("dd").first().filter({ hasText: "0.0.4" }).waitFor();
  const settingsDialog = loaded.getByRole("dialog", { name: "设置", exact: true });
  await settingsDialog.getByRole("button").first().focus();
  const escapedFocus = [];
  for (let i = 0; i < 30; i++) {
    await loaded.keyboard.press("Tab");
    const outside = await loaded.evaluate(() => {
      const active = document.activeElement;
      return active?.closest('[role="dialog"][aria-modal="true"]') ? null : active?.outerHTML.slice(0, 180);
    });
    if (outside) escapedFocus.push(outside);
  }
  console.log("Settings keyboard focus audit:", JSON.stringify({ escapedFocus }));
  assert.deepEqual(escapedFocus, [], "Modal keyboard focus must not reach the background");
  for (let i = 0; i < 30; i++) {
    await loaded.keyboard.press("Shift+Tab");
    assert.equal(await loaded.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"][aria-modal="true"]'))), true);
  }
  for (const name of ["通用设置", "快捷键", "终端", "模型", "插件", "Agent 预设"]) {
    const button = settingsDialog.getByRole("button", { name, exact: true });
    if (await button.count() !== 1) continue;
    await button.click();
    await delay(200);
    console.log("Settings layout audit:", name, await settingsDialog.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth })));
  }
  await loaded.keyboard.press("Escape");
  await loaded.locator('[data-slot="sidebar.settings"] button[aria-expanded="false"]').first().waitFor();
  assert.equal(await loaded.evaluate(() => Boolean(document.activeElement?.closest('[data-slot="sidebar.settings"]'))), true, "Closing settings must restore focus to its trigger");
  assert.equal(await loaded.evaluate(() => getComputedStyle(document.querySelector("[data-dsh-desktop-toolbar]"), "::after").content), "none");
  await loaded.waitForFunction(() => [...document.querySelectorAll(".mydsh-caption-controls button")].every(button => !button.disabled));
  const originalUrl = loaded.url();
  const response = await loaded.evaluate(async () => {
    const result = await fetch("/dsh-market/restart", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return { status: result.status, body: await result.json() };
  });
  assert.equal(response.status, 202, JSON.stringify(response));
  await loaded.waitForURL(url => url.toString() !== originalUrl && /^http:\/\/127\.0\.0\.1:/u.test(url.toString()), { timeout: 90_000 });
  await loaded.locator("[data-dsh-desktop-toolbar]").waitFor({ timeout: 60_000 });
  assert.equal(child.exitCode, null, "Market restart must preserve the Electron process");
  console.log("Market restart returned 202 and desktop-owned Harness restarted without a crash dialog.");
  const savedCloseBehavior = await loaded.evaluate(async () => (await window.minkeDesktop.market.info()).closeBehavior);
  try {
    await loaded.evaluate(() => window.minkeDesktop.market.setCloseBehavior("tray"));
    await loaded.locator(".mydsh-caption-close").click();
    await loaded.waitForFunction(async () => !(await window.minkeDesktop.windowControl("state")).visible);
    assert.equal(child.exitCode, null, "Tray close must leave the application running");
    const activate = spawn(resolve("out/MyDSH-win32-x64/MyDSH.exe"), [], { stdio: "ignore", windowsHide: true });
    await new Promise(done => activate.once("exit", done));
    await loaded.waitForFunction(async () => (await window.minkeDesktop.windowControl("state")).visible);
    console.log("Close-to-tray and single-instance restore passed.");
  } finally {
    await loaded.evaluate(value => window.minkeDesktop.market.setCloseBehavior(value ?? "tray"), savedCloseBehavior);
  }
  console.log("Upstream settings and desktop chrome remain; all optional plugin settings are absent.");
  console.log("Packaged Electron reached the Harness UI using the existing user profile.");
  for (const context of browser.contexts()) for (const page of context.pages()) await page.close();
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
    await page.screenshot({ path: "docs/research/desktop-startup-failure.png" }).catch(() => {});
    console.error("Desktop failure state:", await page.evaluate(() => ({
      title: document.title, sidebar: document.querySelectorAll('[data-slot="sidebar"]').length,
      toggles: document.querySelectorAll('[data-dsh-desktop-sidebar-toggle]').length,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.getAttribute("aria-label")),
    })).catch(() => ({})));
  }
  throw error;
} finally {
  for (let count = 0; count < 10 && child.exitCode === null; count++) await delay(500);
  if (child.exitCode === null) {
    const kill = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    await new Promise((done) => kill.once("exit", done));
  }
  await browser?.close();
}
