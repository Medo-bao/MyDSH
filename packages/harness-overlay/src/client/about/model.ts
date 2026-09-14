export const MINKE_PROJECT_URL =
  "https://github.com/Medo-bao/MyDSH";
export const DEEPSEEK_HARNESS_URL =
  "https://github.com/deepseek-ai/deepseek-harness";

export function platformLabel(platform: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}
