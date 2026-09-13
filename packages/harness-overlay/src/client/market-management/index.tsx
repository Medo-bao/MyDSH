import { useEffect, useState } from "react";
import { MARKET_REPOSITORY, type MarketPort, type MarketStatus } from "../../market-contract.ts";
import { defineOverlayStyle } from "../style-runtime.ts";
import styles from "./styles.css";

export const installMarketManagementStyles = defineOverlayStyle("market-management", styles);
export const marketZh = {
  title: "插件市场管理", installed: "已安装版本", latest: "最新版本", missing: "未安装", unchecked: "尚未检测",
  check: "检测更新", install: "安装最新版", update: "更新插件市场", current: "已是最新版本",
  busy: "处理中…", restart: "重启软件", restartRequired: "安装完成，重启后生效", repository: "GitHub 仓库", unavailable: "桌面服务不可用",
};
export const marketEn: Record<keyof typeof marketZh, string> = {
  title: "Plugin Market Management", installed: "Installed version", latest: "Latest version", missing: "Not installed", unchecked: "Not checked",
  check: "Check for updates", install: "Install latest", update: "Update market", current: "Up to date",
  busy: "Working…", restart: "Restart application", restartRequired: "Installed; restart to apply", repository: "GitHub repository", unavailable: "Desktop service unavailable",
};
export type MarketTranslate = (key: keyof typeof marketZh) => string;
export interface MarketManagementProps { t: MarketTranslate }

export function MarketManagement({ t }: MarketManagementProps) {
  const port = (window as unknown as { minkeDesktop?: { market?: MarketPort } }).minkeDesktop?.market;
  const [status, setStatus] = useState<MarketStatus>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!port) { setBusy(false); return; }
    void port.status().then((value) => { if (active) setStatus(value); })
      .catch((error: unknown) => { if (active) setError(String(error)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [port]);
  const run = async (action: "check" | "install" | "restart") => {
    if (!port || busy) return;
    setBusy(true); setError("");
    try {
      if (action === "restart") await port.restart();
      else setStatus(await port[action]());
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const current = status?.installedVersion != null && status.latestVersion != null && !status.updateAvailable;
  return <section className="firefly-market-management" aria-busy={busy}>
    <h3>{t("title")}</h3>
    <dl>
      <div><dt>{t("installed")}</dt><dd>{status?.installedVersion ?? t("missing")}</dd></div>
      <div><dt>{t("latest")}</dt><dd>{status?.latestVersion ?? t("unchecked")}</dd></div>
    </dl>
    <div className="firefly-market-management__actions">
      <button disabled={!port || busy} onClick={() => void run("check")}>{t("check")}</button>
      <button disabled={!port || busy || current} onClick={() => void run("install")}>{t(current ? "current" : status?.installedVersion ? "update" : "install")}</button>
      {status?.restartRequired && <button disabled={busy} onClick={() => void run("restart")}>{t("restart")}</button>}
      <a href={MARKET_REPOSITORY} target="_blank" rel="noreferrer">{t("repository")}</a>
    </div>
    <p role="status">{busy ? t("busy") : !port ? t("unavailable") : status?.restartRequired ? t("restartRequired") : ""}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
