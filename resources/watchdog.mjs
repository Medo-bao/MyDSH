import { spawn } from "node:child_process";

const executable = process.argv[2];
const delay = Number(process.argv[3] ?? 1500);
let clean = false;

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (chunk.includes("clean")) clean = true;
});
process.stdin.on("end", () => {
  if (clean || typeof executable !== "string" || executable === "") return;
  setTimeout(() => {
    try {
      const child = spawn(executable, ["--watchdog-recovered"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
    } catch {
      // The parent has already exited, so there is nowhere safe to report.
    }
  }, Number.isFinite(delay) ? Math.max(0, delay) : 1500).unref();
});
process.stdin.resume();
