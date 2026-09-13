import { useEffect, useState } from "react";
import { MARKET_REPOSITORY, type DesktopDetails, type MarketPort, type MarketStatus } from "../../market-contract.ts";
import ICON_URL from "@minke/resources/icons/icon.png";
import { MINKE_PROJECT_URL, DEEPSEEK_HARNESS_URL, platformLabel } from "../about/model.ts";
import { defineOverlayStyle } from "../style-runtime.ts";
import styles from "./styles.css";
import { desktopAboutInfo } from "../bridge.ts";

export const installMarketManagementStyles = defineOverlayStyle("market-management", styles);
export const marketZh = {
  title: "关于 MyDSH", desktop: "桌面端版本", harness: "DeepSeek Harness 版本", platform: "运行平台", market: "插件市场", softwareUpdate: "检查软件更新", updating: "正在检查或下载软件更新…", project: "MyDSH", upstream: "DeepSeek Harness", installed: "已安装版本", latest: "最新版本", missing: "未安装", unchecked: "尚未检测",
  check: "检测更新", install: "安装最新版", update: "更新插件市场", current: "已是最新版本",
  busy: "处理中…", restart: "重启软件", restartRequired: "安装完成，重启后生效", repository: "GitHub 仓库", unavailable: "桌面服务不可用",
  cancel: "取消", cancelled: "已取消", cancelling: "正在取消并还原…", checking: "正在检测更新…", prompt: "等待确认更新", downloading: "正在下载…", verifying: "正在校验安装包…", installing: "正在安装…", failed: "操作失败", errorDetails: "错误详情",
};
export const marketEn: Record<keyof typeof marketZh, string> = {
  title: "About MyDSH", desktop: "Desktop version", harness: "DeepSeek Harness version", platform: "Platform", market: "Plugin market", softwareUpdate: "Check for software updates", updating: "Checking or downloading software update…", project: "MyDSH", upstream: "DeepSeek Harness", installed: "Installed version", latest: "Latest version", missing: "Not installed", unchecked: "Not checked",
  check: "Check for updates", install: "Install latest", update: "Update market", current: "Up to date",
  busy: "Working…", restart: "Restart application", restartRequired: "Installed; restart to apply", repository: "GitHub repository", unavailable: "Desktop service unavailable",
  cancel: "Cancel", cancelled: "Cancelled", cancelling: "Cancelling and restoring…", checking: "Checking for updates…", prompt: "Waiting for update confirmation", downloading: "Downloading…", verifying: "Verifying installer…", installing: "Installing…", failed: "Operation failed", errorDetails: "Error details",
};
export type MarketTranslate = (key: keyof typeof marketZh) => string;
export interface MarketManagementProps { t: MarketTranslate }

export function MarketManagement({ t }: MarketManagementProps) {
  const about = desktopAboutInfo();
  const port = (window as unknown as { minkeDesktop?: { market?: MarketPort } }).minkeDesktop?.market;
  const [status, setStatus] = useState<MarketStatus>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<DesktopDetails>();
  const [updateBusy, setUpdateBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => port?.info().then(value => { if (active) setDetails(value); })
      .catch(error => { if (active) setError(String(error)); });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [port]);
  useEffect(() => {
    let active = true;
    if (!port) { setBusy(false); return; }
    const refresh = () => port.status().then((value) => { if (active) setStatus(value); })
      .catch((error: unknown) => { if (active) setError(String(error)); })
      .finally(() => { if (active) setBusy(false); });
    void refresh();
    const timer = window.setInterval(() => { void port.status().then(value => { if (active) { setStatus(value); if (!value.installing) setCancelling(false); } }).catch(() => {}); }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [port]);
  const run = async (action: "check" | "install" | "restart") => {
    if (!port || busy || status?.installing) return;
    setBusy(true); setError("");
    try {
      if (action === "restart") await port.restart();
      else setStatus(await port[action]());
    } catch (error) {
      const latest = await port.status().catch(() => undefined);
      if (latest) setStatus(latest);
      if (!latest?.cancelled) setError(error instanceof Error ? error.message : String(error));
    }
    finally { setBusy(false); }
  };
  const current = status?.installedVersion != null && status.latestVersion != null && !status.updateAvailable;
  const marketBusy = busy || status?.installing === true;
  const updateDesktop = async () => {
    if (!port || updateBusy) return;
    setUpdateBusy(true); setError("");
    setDetails(value => value ? { ...value, updateBusy: true, updatePhase: "checking", updateError: undefined } : value);
    try { await port.updateDesktop(); setDetails(await port.info()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setUpdateBusy(false); }
  };
  const cancel = async (desktop: boolean) => {
    if (!port) return;
    if (!desktop) setCancelling(true);
    try { await (desktop ? port.cancelUpdate() : port.cancel()); }
    catch (error) { setError(String(error)); setCancelling(false); }
  };
  const phase = details?.updatePhase;
  const desktopStatus = phase && phase !== "idle" ? t(phase) : updateBusy ? t("checking") : "";
  const failure = error || status?.error || details?.updateError;
  return <section className="firefly-market-management">
    <header><img src={ICON_URL} alt="" width="40" height="40" /><h3>{t("title")}</h3></header>
    <dl>
      <div><dt>{t("desktop")}</dt><dd>{details?.version ?? (about.version || "—")}</dd></div>
      <div><dt>{t("harness")}</dt><dd>{details?.harnessVersion ?? "—"}</dd></div>
      <div><dt>Electron</dt><dd>{details?.electronVersion ?? "—"}</dd></div>
      <div><dt>{t("platform")}</dt><dd>{details ? details.platform.replace("win32", platformLabel("win32")) : "—"}</dd></div>
    </dl>
    <div className="firefly-market-management__actions">
      <button disabled={!port || updateBusy || details?.updateBusy} onClick={() => void updateDesktop()}>{t("softwareUpdate")}</button>
      {details?.updateBusy && phase !== "prompt" && phase !== "installing" && <button onClick={() => void cancel(true)}>{t("cancel")}</button>}
      <a href={MINKE_PROJECT_URL} target="_blank" rel="noreferrer">{t("project")}</a>
      <a href={DEEPSEEK_HARNESS_URL} target="_blank" rel="noreferrer">{t("upstream")}</a>
    </div>
    <p role="status">{desktopStatus}{phase === "downloading" && details?.updatePercent !== undefined ? ` ${details.updatePercent}%` : ""}</p>
    {phase === "downloading" && <progress aria-label={t("downloading")} max={100} value={details?.updatePercent} />}
    <h3>{t("market")}</h3>
    <dl>
      <div><dt>{t("installed")}</dt><dd>{status ? status.installedVersion ?? t("missing") : t("busy")}</dd></div>
      <div><dt>{t("latest")}</dt><dd>{status?.latestVersion ?? t("unchecked")}</dd></div>
    </dl>
    <div className="firefly-market-management__actions">
      <button disabled={!port || marketBusy} onClick={() => void run("check")}>{t("check")}</button>
      <button disabled={!port || marketBusy || current} onClick={() => void run("install")}>{t(current ? "current" : status?.installedVersion ? "update" : "install")}</button>
      {status?.installing && <button disabled={cancelling} onClick={() => void cancel(false)}>{t("cancel")}</button>}
      {status?.restartRequired && <button disabled={marketBusy} onClick={() => void run("restart")}>{t("restart")}</button>}
      <a href={MARKET_REPOSITORY} target="_blank" rel="noreferrer">{t("repository")}</a>
    </div>
    <p role="status">{cancelling ? t("cancelling") : status?.installing ? t("installing") : busy ? t("checking") : !port ? t("unavailable") : status?.cancelled ? t("cancelled") : status?.restartRequired ? t("restartRequired") : ""}</p>
    {failure && <div role="alert"><p>{t("failed")}</p><details><summary>{t("errorDetails")}</summary><p>{failure}</p></details></div>}
  </section>;
}
