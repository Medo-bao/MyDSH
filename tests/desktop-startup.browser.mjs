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
  const deferSetup = loaded.getByRole("button", { name: "稍后配置", exact: true });
  await deferSetup.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await deferSetup.isVisible()) await deferSetup.click();
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
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 1280, height: 800 }, { width: 960, height: 640 }]) {
    await loaded.setViewportSize(viewport);
    const bounds = await loaded.getByRole("dialog", { name: "设置", exact: true }).boundingBox();
    assert.ok(bounds, "Settings panel must be visible");
    assert.ok(bounds.y >= 68, `Settings top must clear the caption and keep its margin: ${bounds.y}`);
    assert.ok(bounds.y + bounds.height <= viewport.height - 24, "Settings bottom must keep its margin");
    assert.ok(bounds.x >= 24 && bounds.x + bounds.width <= viewport.width - 24);
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
  assert.equal(mask.blur, mask.expectedBlur);
  assert.equal(mask.background, mask.expectedBackground);
  assert.equal(await loaded.locator("[data-firefly-brand-name]").count(), 0);
  assert.equal(await loaded.locator("[data-dsh-desktop-toolbar]").evaluate((element) => getComputedStyle(element).borderBottomWidth), "0px");
  for (const name of ["内置插件", "余额", "自定义提示词", "对话调整", "视觉", "侧边会话"]) {
    assert.equal(await loaded.getByRole("button", { name, exact: true }).count(), 0, `Retired settings remain: ${name}`);
  }
  assert.equal(await loaded.evaluate(() => "dshDesktop" in window), false);
  assert.ok(await loaded.locator("[data-firefly-brand-mark]").count());
  await loaded.screenshot({ path: "docs/research/no-optional-plugins-settings.png" });
  await loaded.screenshot({ path: "docs/research/settings-titlebar-blur.png" });
  await loaded.getByRole("button", { name: "插件市场管理", exact: true }).click();
  const management = loaded.locator(".firefly-market-management");
  await management.getByRole("button", { name: "检测更新", exact: true }).click();
  await management.locator("dd").nth(1).filter({ hasText: /^\d+\.\d+\.\d+/u }).waitFor({ timeout: 25_000 });
  assert.equal(await management.getByRole("link", { name: "GitHub 仓库" }).getAttribute("href"), "https://github.com/dsh-market/dsh-market");
  assert.equal(await management.getByRole("button", { name: /安装最新版|更新插件市场|已是最新版本/u }).count(), 1);
  assert.equal(await management.getByRole("alert").count(), 0);
  await loaded.screenshot({ path: "docs/research/market-management.png" });
  await loaded.keyboard.press("Escape");
  await loaded.locator('[data-slot="sidebar.settings"] button[aria-expanded="false"]').first().waitFor();
  assert.equal(await loaded.evaluate(() => getComputedStyle(document.querySelector("[data-dsh-desktop-toolbar]"), "::after").content), "none");
  console.log("Upstream settings and desktop chrome remain; all optional plugin settings are absent.");
  console.log("Packaged Electron reached the Harness UI using the existing user profile.");
  for (const context of browser.contexts()) for (const page of context.pages()) await page.close();
} finally {
  for (let count = 0; count < 10 && child.exitCode === null; count++) await delay(500);
  if (child.exitCode === null) {
    const kill = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    await new Promise((done) => kill.once("exit", done));
  }
  await browser?.close();
}
