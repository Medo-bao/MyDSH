import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { MARKET_CHECK_CHANNEL, MARKET_INSTALL_CHANNEL, MARKET_RESTART_CHANNEL, MARKET_STATUS_CHANNEL } from "@minke/harness-overlay/market-contract.ts";
import type { MarketManager } from "./market-manager.ts";

export function bindMarketManagement(ipc: Pick<IpcMain, "handle" | "removeHandler">, manager: MarketManager,
  authorize: (event: IpcMainInvokeEvent) => boolean, restart: () => void) {
  const actions = new Map<string, () => unknown>([
    [MARKET_STATUS_CHANNEL, () => manager.status()],
    [MARKET_CHECK_CHANNEL, () => manager.check()],
    [MARKET_INSTALL_CHANNEL, () => manager.install()],
    [MARKET_RESTART_CHANNEL, async () => {
      if (!(await manager.status()).restartRequired) throw new Error("No market restart is pending");
      restart();
    }],
  ]);
  for (const [channel, action] of actions) ipc.handle(channel, (event, ...args) => {
    if (!authorize(event) || args.length !== 0) throw new Error("Unauthorized market request");
    return action();
  });
  return { dispose() { for (const channel of actions.keys()) ipc.removeHandler(channel); } };
}
