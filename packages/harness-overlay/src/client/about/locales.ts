export const zh = {
  trigger: "关于 MyDSH",
  iconAlt: "MyDSH 应用图标",
  tagline: "为 {harness} 打造的原生桌面工作空间",
  metadata: "版本 {version} · {platform} · {arch}",
  community:
    "MyDSH 是基于 DeepSeek Harness 构建的独立桌面项目。",
  project: "MyDSH",
  harness: "DeepSeek Harness",
  close: "关闭",
} as const;

export type AboutLocaleKey = keyof typeof zh;
export type AboutTranslate = (
  key: AboutLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const en: Record<AboutLocaleKey, string> = {
  trigger: "About MyDSH",
  iconAlt: "MyDSH app icon",
  tagline: "A native desktop workspace for {harness}",
  metadata: "Version {version} · {platform} · {arch}",
  community:
    "MyDSH is an independent desktop project built on DeepSeek Harness.",
  project: "MyDSH",
  harness: "DeepSeek Harness",
  close: "Close",
};
