import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  type LocalModelRuntimeId,
} from "@minke/harness-overlay/model-runtime-settings-contract.ts";
import {
  harnessWebArguments,
} from "./harness-launch.ts";

const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+(?:\/\?token=[A-Za-z0-9_-]+)?)[ \t]*\r?\n/u;
const MAX_CAPTURED_OUTPUT = 64 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 90_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

export async function verifyHarnessIdentity(url: string, secret: string): Promise<void> {
  const origin = new URL(validateReadyUrl(url)).origin;
  const challenge = randomBytes(32).toString("hex");
  const response = await fetch(`${origin}/firefly-desktop-identity?challenge=${challenge}`, {
    signal: AbortSignal.timeout(5_000), redirect: "error",
  });
  if (!response.ok) throw new Error("Harness identity verification failed");
  const result = await response.json() as { proof?: unknown };
  const expected = createHmac("sha256", secret).update(`${new URL(origin).host}\n${challenge}`).digest();
  if (typeof result.proof !== "string" || !/^[a-f0-9]{64}$/u.test(result.proof)
    || !timingSafeEqual(expected, Buffer.from(result.proof, "hex"))) {
    throw new Error("Harness identity verification failed");
  }
}

/** Availability check only: the boot manifest is not an authentication token. */
export async function verifyHarnessWebBoot(url: string): Promise<void> {
  validateReadyUrl(url);
  let response = await fetch(url, {
    signal: AbortSignal.timeout(5_000),
    redirect: "manual",
  });
  if (response.status === 303 && new URL(url).searchParams.has("token")
    && response.headers.get("location") === "/") {
    const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    response = await fetch(new URL("/", url), {
      headers: { cookie }, signal: AbortSignal.timeout(5_000), redirect: "error",
    });
  }
  if (!response.ok) throw new Error(`Harness Web boot returned HTTP ${response.status}`);
  const html = await response.text();
  const match = /<script[^>]*>(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\])\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/u.exec(html);
  if (match?.[1] === undefined) throw new Error("Harness Web boot manifest is missing");
  const manifest = JSON.parse(match[1]) as { entries?: unknown };
  if (!Array.isArray(manifest.entries) || !manifest.entries.some(
    (entry: unknown) => typeof entry === "object" && entry !== null
      && "id" in entry && entry.id === "@firefly-harness/bundle-companion",
  )) throw new Error("Harness Web boot is missing the Firefly product bundle");
}

export interface HarnessRuntimeExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

export interface HarnessRuntimeOptions {
  dshEntryPath: string;
  resolveEntryPath?: () => Promise<string>;
  nodeExecutable: string;
  dataRoot: string;
  electronExecutable: string;
  modelRuntimes: LocalModelRuntimeLaunchOptions;
  onUnexpectedExit(exit: HarnessRuntimeExit): void;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export type LocalModelRuntimeLaunchOptions = Record<
  LocalModelRuntimeId,
  {
    enabled: boolean;
    command?: string;
  }
>;

type HarnessRuntimeEnvironmentOptions = Pick<
  HarnessRuntimeOptions,
  | "dataRoot"
  | "electronExecutable"
  | "modelRuntimes"
>;

const LOCAL_MODEL_ENVIRONMENT = [
  {
    id: "lmStudio",
    enabled: "MINKE_LM_STUDIO_ENABLED",
    command: "MINKE_LM_STUDIO_COMMAND",
  },
  {
    id: "ollama",
    enabled: "MINKE_OLLAMA_ENABLED",
    command: "MINKE_OLLAMA_COMMAND",
  },
] as const satisfies readonly {
  id: LocalModelRuntimeId;
  enabled: string;
  command: string;
}[];

/** Build the explicit child environment without inheriting stale Minke flags. */
export function harnessRuntimeEnvironment(
  options: HarnessRuntimeEnvironmentOptions,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...inherited,
    DSH_ELECTRON_EXECUTABLE: options.electronExecutable,
    DSH_HOME: options.dataRoot,
  };
  delete environment.DSH_PNPM_ENTRY;
  delete environment.FIREFLY_HARNESS_SECRET;
  for (const descriptor of LOCAL_MODEL_ENVIRONMENT) {
    const runtime = options.modelRuntimes[descriptor.id];
    environment[descriptor.enabled] =
      runtime.enabled ? "1" : "0";
    const command = runtime.command?.trim();
    if (command === undefined || command === "") {
      delete environment[descriptor.command];
    } else {
      environment[descriptor.command] = command;
    }
  }
  return environment;
}

/**
 * Owns the complete Harness process lifecycle. Callers only need to start and
 * stop it; system dsh invocation, readiness parsing, output capture, and
 * process-tree termination stay behind this interface.
 */
export class HarnessRuntime {
  readonly #options: HarnessRuntimeOptions;
  #child: ChildProcess | undefined;
  #output = "";
  #stopping = false;
  #ready = false;

  constructor(options: HarnessRuntimeOptions) {
    this.#options = options;
  }

  async start(): Promise<string> {
    if (this.#child !== undefined) {
      throw new Error("Harness runtime is already running");
    }

    await mkdir(this.#options.dataRoot, { recursive: true });

    this.#output = "";
    this.#stopping = false;
    this.#ready = false;

    const entryPath = await this.#options.resolveEntryPath?.() ?? this.#options.dshEntryPath;
    const launchSecret = randomBytes(32).toString("hex");
    const child = spawn(
      this.#options.nodeExecutable,
      [entryPath, ...harnessWebArguments()],
      {
        cwd: this.#options.dataRoot,
        detached: process.platform !== "win32",
        env: { ...harnessRuntimeEnvironment(this.#options), FIREFLY_HARNESS_SECRET: launchSecret },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#child = child;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.#capture(chunk));
    child.stderr?.on("data", (chunk: string) => this.#capture(chunk));

    child.once("exit", (code, signal) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      const exit = { code, signal, output: this.#diagnostics() };
      if (this.#ready && !this.#stopping) {
        this.#options.onUnexpectedExit(exit);
      }
    });

    try {
      const url = await this.#waitUntilReady(child);
      await verifyHarnessIdentity(url, launchSecret);
      await verifyHarnessWebBoot(url);
      // Allow a queued process exit to settle before publishing readiness.
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Harness exited immediately after readiness (code ${String(child.exitCode)}, signal ${String(child.signalCode)})\n${this.#diagnostics()}`,
        );
      }
      this.#ready = true;
      return url;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (child === undefined) return;

    this.#stopping = true;
    this.#signalProcessTree(child, "SIGTERM");
    const exited = await this.#waitForExit(
      child,
      this.#options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    );
    if (!exited) {
      this.#signalProcessTree(child, "SIGKILL");
      await this.#waitForExit(child, 1_000);
    }
    if (this.#child === child) this.#child = undefined;
    this.#ready = false;
  }

  #capture(chunk: string): void {
    this.#output = `${this.#output}${chunk}`.slice(-MAX_CAPTURED_OUTPUT);
  }

  #diagnostics(): string {
    return this.#output.replace(/([?&]token=)[^\s]*/gu, "$1[redacted]");
  }

  async #waitUntilReady(child: ChildProcess): Promise<string> {
    const timeoutMs =
      this.#options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

    return await new Promise<string>((resolvePromise, reject) => {
      let settled = false;

      const finish = (error?: Error, url?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout?.off("data", inspect);
        child.stderr?.off("data", inspect);
        child.off("error", onError);
        child.off("exit", onExit);
        if (error !== undefined) reject(error);
        else resolvePromise(url as string);
      };

      const inspect = () => {
        const match = READY_PATTERN.exec(this.#output);
        if (match?.[1] === undefined) return;
        try {
          finish(undefined, validateReadyUrl(match[1]));
        } catch (error) {
          finish(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      };
      const onError = (error: Error) => finish(error);
      const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
        finish(
          new Error(
            `Harness exited before readiness (code ${String(code)}, signal ${String(signal)})\n${this.#diagnostics()}`,
          ),
        );
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              `Harness did not become ready within ${String(timeoutMs)} ms\n${this.#diagnostics()}`,
            ),
          ),
        timeoutMs,
      );

      child.stdout?.on("data", inspect);
      child.stderr?.on("data", inspect);
      child.once("error", onError);
      child.once("exit", onExit);
      inspect();
    });
  }

  #signalProcessTree(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): void {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      if (process.platform === "win32") {
        spawn(
          "taskkill.exe",
          [
            "/pid",
            String(child.pid),
            "/t",
            ...(signal === "SIGKILL" ? ["/f"] : []),
          ],
          { stdio: "ignore", windowsHide: true },
        );
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH") throw error;
    }
  }

  async #waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return await new Promise<boolean>((resolvePromise) => {
      const timeout = setTimeout(() => {
        child.off("exit", onExit);
        resolvePromise(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timeout);
        resolvePromise(true);
      };
      child.once("exit", onExit);
    });
  }
}

function validateReadyUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== "" || url.pathname !== "/" ||
    [...url.searchParams.keys()].some((key) => key !== "token") ||
    url.searchParams.getAll("token").length > 1
  ) {
    throw new Error("Harness published an unsafe readiness URL");
  }
  return url.href;
}
