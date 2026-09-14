import {
  translateDesktop,
} from "@minke/desktop/i18n";
import type { DesktopLocale } from "@minke/desktop/locale-contract";
import FIREFLY_ICON_URL from "@minke/resources/icons/icon.png";
import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "@lucide/icons";
import { buildLucideDataUri } from "@lucide/icons/build";
import type { WindowAction, WindowState } from "@minke/harness-overlay/window-control-contract.ts";

export interface AppProps {
  locale: DesktopLocale;
}

export default function App({ locale }: AppProps) {
  const port = (window as unknown as { minkeDesktop?: {
    windowControl(action: WindowAction): Promise<WindowState>;
    windowState(callback: (state: WindowState) => void): () => void;
  } }).minkeDesktop;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => port?.windowState(state => setMaximized(state.maximized)), [port]);
  return (
    <main className="grid min-h-screen place-items-center bg-transparent">
      <header className="mydsh-bootstrap-caption">
        {([
          ["minimize", Minus, locale === "zh" ? "最小化" : "Minimize"],
          ["maximize", maximized ? Copy : Square, locale === "zh" ? "最大化或还原" : "Maximize or restore"],
          ["close", X, locale === "zh" ? "关闭" : "Close"],
        ] as const).map(([action, icon, label]) => <button key={action} className={`mydsh-bootstrap-${action}`} title={label} aria-label={label}
          onClick={() => { void port?.windowControl(action).catch(error => console.error("Window action failed:", error)); }}>
          <span style={{ maskImage: `url("${buildLucideDataUri(icon, { size: 16 })}")` }} aria-hidden="true" />
        </button>)}
      </header>
      <div className="flex flex-col items-center gap-5">
        <img
          className="size-20 rounded-[22%] shadow-2xl shadow-black/30"
          src={FIREFLY_ICON_URL}
          alt="MyDSH"
        />
        <div className="minke-bootstrap__status flex items-center gap-2.5 text-sm">
          <span className="minke-bootstrap__pulse size-1.5 animate-pulse rounded-full" />
          {translateDesktop(locale, "bootstrap.loading")}
        </div>
      </div>
    </main>
  );
}
