import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { compareReleaseVersions } from "./version-order.ts";

interface ReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  url?: unknown;
}

interface ReleaseResponse {
  tag_name?: unknown;
  name?: unknown;
  assets?: unknown;
}

export interface ClientUpdateSource {
  name: "GitHub" | "Gitee";
  apiUrl: string;
}

export interface ClientUpdate {
  version: string;
  source: ClientUpdateSource;
  installerName: string;
  installerUrl: string;
  checksumUrl?: string;
  mirrors: readonly {
    source: ClientUpdateSource;
    installerUrl: string;
    checksumUrl?: string;
  }[];
}

export class ClientUpdater {
  readonly #currentVersion: string;
  readonly #updatesRoot: string;
  readonly #sources: readonly ClientUpdateSource[];

  constructor(options: {
    currentVersion: string;
    updatesRoot: string;
    sources: readonly ClientUpdateSource[];
  }) {
    this.#currentVersion = options.currentVersion;
    this.#updatesRoot = options.updatesRoot;
    this.#sources = options.sources.filter((source) => source.apiUrl.trim() !== "");
  }

  get enabled(): boolean {
    return this.#sources.length > 0;
  }

  async check(): Promise<ClientUpdate | undefined> {
    if (!this.enabled) return undefined;
    const errors: unknown[] = [];
    let candidate: ClientUpdate | undefined;
    for (const source of this.#sources) {
      try {
        const update = await this.#checkSource(source);
        if (update === undefined) continue;
        if (
          candidate === undefined ||
          compareReleaseVersions(update.version, candidate.version) > 0
        ) {
          candidate = update;
        } else if (update.version === candidate.version) {
          candidate = {
            ...candidate,
            mirrors: [
              ...candidate.mirrors,
              {
                source: update.source,
                installerUrl: update.installerUrl,
                ...(update.checksumUrl === undefined ? {} : { checksumUrl: update.checksumUrl }),
              },
            ],
          };
        }
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === this.#sources.length) {
      throw new AggregateError(errors, "All desktop update sources failed");
    }
    return candidate;
  }

  async download(update: ClientUpdate): Promise<string> {
    await mkdir(this.#updatesRoot, { recursive: true });
    const finalPath = join(this.#updatesRoot, safeFilename(update.installerName));
    const partialPath = `${finalPath}.part`;
    await rm(partialPath, { force: true });
    const mirrors = [
      {
        source: update.source,
        installerUrl: update.installerUrl,
        ...(update.checksumUrl === undefined ? {} : { checksumUrl: update.checksumUrl }),
      },
      ...update.mirrors,
    ];
    const failures: unknown[] = [];
    for (const mirror of mirrors) {
      try {
        const payload = await fetchBuffer(mirror.installerUrl);
        await writeFile(partialPath, payload);
        if (mirror.checksumUrl !== undefined) {
          const checksumText = (await fetchBuffer(mirror.checksumUrl)).toString("utf8");
          const expected = checksumFor(checksumText, update.installerName);
          if (expected === undefined) {
            throw new Error("Release checksum list does not include the selected installer");
          }
          const actual = createHash("sha256").update(payload).digest("hex");
          if (actual.toLowerCase() !== expected.toLowerCase()) {
            throw new Error("Downloaded desktop installer failed SHA-256 verification");
          }
        }
        await rm(finalPath, { force: true });
        await rename(partialPath, finalPath);
        await access(finalPath);
        return finalPath;
      } catch (error) {
        failures.push(error);
        await rm(partialPath, { force: true });
      }
    }
    throw new AggregateError(failures, "All desktop update downloads failed");
  }

  async launchInstaller(installerPath: string): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(installerPath, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolvePromise();
      });
    });
  }

  async #checkSource(source: ClientUpdateSource): Promise<ClientUpdate | undefined> {
    const response = await fetch(source.apiUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "DeepSeek-Harness-Desktop-Updater",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`${source.name} release request failed with HTTP ${String(response.status)}`);
    }
    const release = await response.json() as ReleaseResponse;
    const version = typeof release.tag_name === "string"
      ? release.tag_name.replace(/^v/u, "")
      : typeof release.name === "string" ? release.name.replace(/^v/u, "") : undefined;
    if (
      version === undefined ||
      compareReleaseVersions(version, this.#currentVersion) <= 0
    ) return undefined;
    const assets = Array.isArray(release.assets) ? release.assets as ReleaseAsset[] : [];
    const installer = assets.find((asset) => isInstaller(asset.name));
    const installerUrl = assetUrl(installer);
    if (installer === undefined || typeof installer.name !== "string" || installerUrl === undefined) {
      throw new Error(`${source.name} release does not contain a compatible installer`);
    }
    const checksum = assets.find((asset) =>
      typeof asset.name === "string" && /^(SHA256SUMS|checksums\.txt)$/iu.test(asset.name),
    );
    return {
      version,
      source,
      installerName: installer.name,
      installerUrl,
      ...(assetUrl(checksum) === undefined ? {} : { checksumUrl: assetUrl(checksum) }),
      mirrors: [],
    };
  }
}

export function configuredClientUpdateSources(environment: NodeJS.ProcessEnv): ClientUpdateSource[] {
  return [
    { name: "GitHub", apiUrl: environment.DSH_DESKTOP_GITHUB_RELEASE_API?.trim() ?? "https://api.github.com/repos/Medo-bao/MyDSH/releases/latest" },
    { name: "Gitee", apiUrl: environment.DSH_DESKTOP_GITEE_RELEASE_API?.trim() ?? "" },
  ];
}

function assetUrl(asset: ReleaseAsset | undefined): string | undefined {
  if (typeof asset?.browser_download_url === "string") return asset.browser_download_url;
  return typeof asset?.url === "string" ? asset.url : undefined;
}

function isInstaller(name: unknown): boolean {
  if (typeof name !== "string") return false;
  if (!/(?:setup|installer).*\.exe$/iu.test(name)) return false;
  const normalized = name.toLowerCase();
  return !normalized.includes("arm64") && !normalized.includes("x86");
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Update download failed with HTTP ${String(response.status)}`);
  return Buffer.from(await response.arrayBuffer());
}

function checksumFor(contents: string, filename: string): string | undefined {
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/iu.exec(line.trim());
    if (match?.[2] !== undefined && basename(match[2]) === filename) return match[1];
  }
  return undefined;
}

function safeFilename(value: string): string {
  const name = basename(value);
  if (name !== value || name === "." || name === "..") throw new Error("Unsafe update filename");
  return name;
}
