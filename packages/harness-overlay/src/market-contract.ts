export const MARKET_STATUS_CHANNEL = "firefly:market:status";
export const MARKET_CHECK_CHANNEL = "firefly:market:check";
export const MARKET_INSTALL_CHANNEL = "firefly:market:install";
export const MARKET_RESTART_CHANNEL = "firefly:market:restart";
export const MARKET_REPOSITORY = "https://github.com/dsh-market/dsh-market";

export interface MarketStatus {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  restartRequired: boolean;
}

export interface MarketPort {
  status(): Promise<MarketStatus>;
  check(): Promise<MarketStatus>;
  install(): Promise<MarketStatus>;
  restart(): Promise<void>;
}
