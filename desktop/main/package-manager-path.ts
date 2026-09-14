import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import type { HarnessRuntimeLayout } from "./harness-launch.ts";

export async function preparePackageManagerBin(home: string, runtime: Pick<HarnessRuntimeLayout, "pnpmExecutable" | "pnpmArguments">): Promise<string> {
  const bin = join(home, "desktop-bin");
  const quote = (value: string) => {
    if (/["\r\n%!]/u.test(value)) throw new Error("Unsupported package manager command path");
    return `"${value}"`;
  };
  const command = [runtime.pnpmExecutable, ...runtime.pnpmArguments].map(quote).join(" ");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "pnpm.cmd"), `@echo off\r\n${command} %*\r\n`, "utf8");
  return bin;
}

export function packageManagerEnvironment(inherited: NodeJS.ProcessEnv, bin: string, node: string): NodeJS.ProcessEnv {
  const environment = { ...inherited };
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === "path");
  const previous = pathKey ? environment[pathKey] : "";
  for (const key of Object.keys(environment)) if (key.toLowerCase() === "path") delete environment[key];
  environment.PATH = [bin, dirname(node), previous].filter(Boolean).join(delimiter);
  return environment;
}
