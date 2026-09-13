import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { MARKET_CHECK_CHANNEL, MARKET_INSTALL_CHANNEL, MARKET_RESTART_CHANNEL, MARKET_STATUS_CHANNEL } from "@minke/harness-overlay/market-contract.ts";
import type { MarketManager } from "./market-manager.ts";
import { MARKET_CANCEL_CHANNEL, DESKTOP_CANCEL_UPDATE_CHANNEL } from "@minke/harness-overlay/market-contract.ts";
import { DESKTOP_INFO_CHANNEL, DESKTOP_UPDATE_CHANNEL, type DesktopDetails } from "@minke/harness-overlay/market-contract.ts";

export function bindMarketManagement(ipc: Pick<IpcMain, "handle" | "removeHandler">, manager: MarketManager,
  authorize: (event: IpcMainInvokeEvent) => boolean, restart: () => void,
  desktop?: { info(): Promise<DesktopDetails>; update(): Promise<void>; cancel?(): void }) {
  const actions = new Map<string, () => unknown>([
    [MARKET_STATUS_CHANNEL, () => manager.status()],
    [MARKET_CHECK_CHANNEL, () => manager.check()],
    [MARKET_INSTALL_CHANNEL, () => manager.install()],
    [MARKET_CANCEL_CHANNEL, () => manager.cancel()],
    [MARKET_RESTART_CHANNEL, async () => {
      if (!(await manager.status()).restartRequired) throw new Error("No market restart is pending");
      restart();
    }],
  ]);
  if (desktop) {
    actions.set(DESKTOP_INFO_CHANNEL, () => desktop.info());
    actions.set(DESKTOP_UPDATE_CHANNEL, () => desktop.update());
    actions.set(DESKTOP_CANCEL_UPDATE_CHANNEL, () => desktop.cancel?.());
  }
  for (const [channel, action] of actions) ipc.handle(channel, (event, ...args) => {
    if (!authorize(event) || args.length !== 0) throw new Error("Unauthorized market request");
    return action();
  });
  return { dispose() { for (const channel of actions.keys()) ipc.removeHandler(channel); } };
}
