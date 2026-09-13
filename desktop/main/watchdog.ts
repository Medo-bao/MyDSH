import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

export type MainProcessWatchdog = Readonly<{
  markCleanExit(): void;
}>;

export function startMainProcessWatchdog(options: Readonly<{
  nodeExecutable: string;
  resourcesPath: string;
  executable: string;
}>): MainProcessWatchdog {
  let child: ChildProcess | undefined;
  try {
    child = spawn(
      options.nodeExecutable,
      [join(options.resourcesPath, "watchdog.mjs"), options.executable, "1500"],
      {
        detached: true,
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      },
    );
    child.unref();
  } catch (error) {
    console.error("Unable to start the main-process watchdog:", error);
  }
  return Object.freeze({
    markCleanExit() {
      try {
        child?.stdin?.end("clean\n");
      } catch {
        // A watchdog that already exited needs no cleanup signal.
      }
      child = undefined;
    },
  });
}
