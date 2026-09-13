type QuitApplication = Readonly<{
  exit(code?: number): void;
  once(event: "quit", listener: () => void): unknown;
  quit(): void;
}>;

const DEFAULT_FORCE_EXIT_DELAY_MS = 7_500;

/**
 * Ask Electron to run its ordinary before-quit cleanup, but never leave a
 * tray-requested quit waiting forever on a child process that will not exit.
 */
export function requestApplicationQuit(
  application: QuitApplication,
  forceExitDelayMs = DEFAULT_FORCE_EXIT_DELAY_MS,
): void {
  const fallback = setTimeout(() => {
    application.exit(0);
  }, forceExitDelayMs);
  fallback.unref();
  application.once("quit", () => {
    clearTimeout(fallback);
  });
  application.quit();
}
