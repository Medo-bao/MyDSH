import { spawn } from "node:child_process";

export async function runCancellableProcess(executable: string, args: readonly string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal;
}): Promise<void> {
  options.signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args], { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let failure: Error | undefined;
    let stopping: Promise<void> | undefined;
    const collect = (data: Buffer) => { output = (output + data.toString()).slice(-3000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const stop = () => {
      if (stopping || child.pid === undefined || child.exitCode !== null) return;
      stopping = new Promise<void>(done => {
        if (process.platform !== "win32") { child.kill("SIGKILL"); done(); return; }
        const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => { child.kill(); done(); });
        killer.once("close", () => done());
      });
    };
    options.signal.addEventListener("abort", stop, { once: true });
    if (options.signal.aborted) stop();
    child.once("error", error => { failure = error; });
    child.once("close", async code => {
      options.signal.removeEventListener("abort", stop);
      await stopping;
      // Do not release the transaction until the writer has actually exited.
      if (options.signal.aborted) reject(options.signal.reason);
      else if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Installation failed (exit ${String(code)})\n${output}`));
      else resolve();
    });
  });
}
