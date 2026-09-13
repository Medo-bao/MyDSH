import { runCancellableProcess } from "./cancellable-process.ts";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MARKET_REPOSITORY, type MarketStatus } from "@minke/harness-overlay/market-contract.ts";
import { readHarnessRuntimeLayout } from "./harness-launch.ts";
import { pluginInstallTransaction } from "./plugin-install-transaction.ts";
import { compareReleaseVersions } from "./version-order.ts";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export function marketReleaseVersion(value: unknown): string {
  const manifest = value as { name?: unknown; version?: unknown; repository?: { url?: unknown } } | null;
  const repository = manifest?.repository?.url;
  if (manifest?.name !== "dshmarket" || typeof manifest.version !== "string" || !VERSION.test(manifest.version)
    || typeof repository !== "string" || repository.replace(/^git\+/u, "").replace(/\.git$/u, "") !== MARKET_REPOSITORY) {
    throw new Error("Invalid plugin market release metadata");
  }
  return manifest.version;
}

async function latestRelease(signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("https://registry.npmjs.org/dshmarket/latest", {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Market update check failed: HTTP ${response.status}`);
  return response.json();
}

async function installRelease(home: string, version: string, signal: AbortSignal): Promise<void> {
  const runtime = await readHarnessRuntimeLayout();
  await runCancellableProcess(runtime.pnpmExecutable, [...runtime.pnpmArguments,
      "add", "--save-exact", "--ignore-scripts", "--registry=https://registry.npmjs.org", `dshmarket@${version}`,
      `@deepseek-ai/dsh-settings@${runtime.dshVersion}`,
    ], { cwd: join(home, "profiles", "web"), env: { ...process.env, DSH_HOME: home }, signal });
}

export class MarketManager {
  readonly home: string;
  readonly dependencies: { latestRelease: typeof latestRelease; installRelease: typeof installRelease };
  #latest: string | null = null;
  #restartRequired = false;
  #installing = false;
  #controller?: AbortController;
  #error: string | null = null;
  #cancelled = false;
  #idle: Promise<void> = Promise.resolve();

  constructor(home: string, dependencies = {
    latestRelease, installRelease,
  }) { this.home = home; this.dependencies = dependencies; }

  get installing(): boolean { return this.#installing; }
  whenIdle(): Promise<void> { return this.#idle; }
  cancel(): void { this.#controller?.abort(new DOMException("Installation cancelled", "AbortError")); }

  async #installed(): Promise<string | null> {
    try {
      const profile = JSON.parse(await readFile(join(this.home, "profiles", "web", "package.json"), "utf8"));
      if (!Object.hasOwn(profile.dependencies ?? {}, "dshmarket")) return null;
      const manifest = JSON.parse(await readFile(join(this.home, "profiles", "web", "node_modules", "dshmarket", "package.json"), "utf8"));
      if (manifest.name !== "dshmarket" || !VERSION.test(manifest.version)) throw new Error("Invalid installed market package");
      return manifest.version;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async status(): Promise<MarketStatus> {
    const installedVersion = await this.#installed();
    return { installing: this.#installing, error: this.#error, cancelled: this.#cancelled, installedVersion, latestVersion: this.#latest, restartRequired: this.#restartRequired,
      updateAvailable: this.#latest !== null && (installedVersion === null || compareReleaseVersions(this.#latest, installedVersion) > 0) };
  }

  async check(signal?: AbortSignal): Promise<MarketStatus> {
    this.#latest = marketReleaseVersion(await this.dependencies.latestRelease(signal));
    return this.status();
  }

  async install(): Promise<MarketStatus> {
    if (this.#installing) throw new Error("A market installation is already running");
    this.#installing = true;
    this.#error = null;
    this.#cancelled = false;
    this.#controller = new AbortController();
    const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(300_000)]);
    let finish!: () => void;
    this.#idle = new Promise<void>((resolve) => { finish = resolve; });
    try {
      const status = await this.check(signal);
      signal.throwIfAborted();
      const version = status.latestVersion!;
      if (status.installedVersion !== null && compareReleaseVersions(version, status.installedVersion) < 0) return status;
      if (status.installedVersion === version) {
        const profile = JSON.parse(await readFile(join(this.home, "profiles", "web", "package.json"), "utf8"));
        if (profile.dsh?.profile?.bundles?.includes("dshmarket")) return status;
      }
      const transaction = await pluginInstallTransaction(this.home, join(this.home, "firefly-plugin-state.json"));
      await transaction(async () => {
        await this.dependencies.installRelease(this.home, version, signal);
        signal.throwIfAborted();
        if (await this.#installed() !== version) throw new Error("Market installation version verification failed");
        const path = join(this.home, "profiles", "web", "package.json");
        const profile = JSON.parse(await readFile(path, "utf8"));
        const bundles = profile.dsh?.profile?.bundles;
        if (!Array.isArray(bundles) || !bundles.every((item: unknown) => typeof item === "string")) throw new Error("Invalid Harness bundle list");
        if (!bundles.includes("dshmarket")) {
          bundles.push("dshmarket");
          const temporary = `${path}.market.tmp`;
          await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`);
          await rename(temporary, path);
        }
      });
      this.#restartRequired = true;
      return this.status();
    } catch (error) {
      this.#cancelled = error === signal.reason && signal.reason?.name === "AbortError";
      this.#error = this.#cancelled ? null : error instanceof Error ? error.message : String(error);
      throw error;
    } finally { this.#installing = false; this.#controller = undefined; finish(); }
  }
}
