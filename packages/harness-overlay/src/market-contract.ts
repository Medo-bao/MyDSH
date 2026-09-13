export const MARKET_STATUS_CHANNEL = "firefly:market:status";
export const MARKET_CHECK_CHANNEL = "firefly:market:check";
export const MARKET_INSTALL_CHANNEL = "firefly:market:install";
export const MARKET_RESTART_CHANNEL = "firefly:market:restart";
export const MARKET_REPOSITORY = "https://github.com/dsh-market/dsh-market";
export const DESKTOP_INFO_CHANNEL = "mydsh:about:info";
export const DESKTOP_UPDATE_CHANNEL = "mydsh:about:update";
export const DESKTOP_CANCEL_UPDATE_CHANNEL = "mydsh:about:cancel-update";
export const MARKET_CANCEL_CHANNEL = "firefly:market:cancel";

export interface DesktopDetails {
  version: string;
  harnessVersion: string;
  electronVersion: string;
  platform: string;
  updateBusy: boolean;
  updatePhase?: "idle" | "checking" | "prompt" | "downloading" | "verifying" | "installing" | "failed" | "cancelled" | "current";
  updatePercent?: number;
  updateError?: string;
}

export interface MarketStatus {
  installing?: boolean;
  error?: string | null;
  cancelled?: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  restartRequired: boolean;
}

export interface MarketPort {
  info(): Promise<DesktopDetails>;
  updateDesktop(): Promise<void>;
  cancelUpdate(): Promise<void>;
  cancel(): Promise<void>;
  status(): Promise<MarketStatus>;
  check(): Promise<MarketStatus>;
  install(): Promise<MarketStatus>;
  restart(): Promise<void>;
}
