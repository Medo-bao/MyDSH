<p align="center">
  <img src="./resources/icons/icon.png" width="112" alt="MyDSH 图标">
</p>

<h1 align="center">MyDSH</h1>

<p align="center">
  <strong>为 DeepSeek Harness 打造的原生桌面工作空间</strong>
</p>

<p align="center">
  简体中文 · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="./PROJECT_STATUS.zh-CN.md">项目状态</a> ·
  <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>
</p>

MyDSH 在本地运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，将它带入一个专注、本地优先的智能体桌面工作空间。对话、项目文件、终端、网页工具和原生桌面操作始终触手可及，无需在多个应用之间切换，让工作流保持完整。

> [!IMPORTANT]
> MyDSH 正在持续开发中，功能、打包方式和本地数据结构可能随项目迭代发生变化。MyDSH 是独立的社区项目，并非 DeepSeek 官方产品。

## 核心亮点

- **一个完整的智能体工作台** — MyDSH 将 DeepSeek Harness 从对话窗口扩展成完整的工作空间。文件、终端、网页工具和插件发现能力可以放在彼此独立的右侧与底部工作区中，让理解项目、修改内容和验证结果所需的工具始终与当前对话相邻。
- **本地优先，数据留在设备** — DeepSeek Harness 在本地运行，MyDSH 应用状态和浏览器会话数据也保留在用户设备上。为兼容现有安装，桌面配置继续存放在 `~/.minke` 下。
- **Windows 原生桌面体验** — 原生菜单、可配置快捷键、Session 日志导出、主题同步和中英文界面，针对 Windows x64 日常使用进行验证。

## 安装

当前版本为 **0.0.3**，只提供 Windows x64 安装包。请从 [MyDSH 发布页](https://github.com/Medo-bao/MyDSH/releases) 下载，并核对随包的 SHA-256 清单。

运行前需要系统 PATH 中有 Node.js 24+、Corepack/pnpm 11.7.0 和 `@deepseek-ai/dsh@0.1.5-rc.2`。安装包不包含这三项运行环境。托盘只检查 MyDSH 桌面端更新，不检查或安装上游 Harness 更新。插件市场按需安装，不默认预装；上游名称保留，桌面图标使用 MyDSH 品牌。

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| Windows | `x64` | `.exe` |

### Windows

1. 下载 Windows x64 `.exe` 安装程序。
2. 运行安装程序，并按照界面提示完成安装。
3. 新发布的预览版本可能触发 Windows 信誉安全提示。请先核对安装包来源和 SHA-256，再决定是否继续。

## 从源码构建

请在 Windows x64 主机上构建 MyDSH。发布安装包位于 `out/nsis`，本项目当前不支持 macOS/Linux 或跨平台打包。

环境依赖：

- 支持 submodule 的 Git，并确保已检出 `vendor/deepseek-harness` 子模块。
- Node.js 24 或更高版本。
- pnpm 11.7.0；执行脚本前需已安装仓库依赖。
- Windows：Windows x64；如果原生依赖需要在本地编译，可能还需要安装 Visual Studio 2022 Build Tools，并选择 **Desktop development with C++** 工作负载。

首次检出源码后安装仓库依赖，并准备系统 DSH（该全局安装命令会修改当前用户的 DSH 安装）：

```bash
pnpm install --frozen-lockfile
pnpm add --global @deepseek-ai/dsh@0.1.5-rc.2 --config.node-linker=hoisted --config.enable-global-virtual-store=false
```

系统 Node 安装目录需提供 Corepack，Corepack 的 pnpm 应为 11.7.0；全局 `dsh` shim 需在 PATH 中。`harness:stage` 仅用于隔离构建和审计历史 staging 格式，不是应用启动前置条件，也不会替代系统安装。

使用开发模式启动 MyDSH：

```bash
pnpm start
```

`pnpm start` 会构建 Firefly bundle 并启动开发应用。系统 Node、pnpm 和 dsh 必须先通过 PATH 检测；需要重建隔离 runtime 时执行 `pnpm run harness:stage`。

为当前平台生成安装包：

```bash
pnpm package
pnpm nsis:make
```

安装包输出到 `out/nsis`；`pnpm make` 仍可生成开发用 Squirrel 构建。发布使用 NSIS 安装包，不嵌入系统 Node、pnpm 或 dsh。

本项目基于的DeepSeek Harness的桌面适配层构建，保留各组件原始许可证与版权声明。
