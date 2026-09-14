# MyDSH 0.0.4

1.修复了链接无法正常跳转的bug
2.修复了网络代理报错的bug
3.优化了使用体验

## MyDSH 0.0.3

- 新增关闭窗口行为设置：最小化到托盘或直接退出。
- 修复插件市场重启引起的异常退出提示，由桌面端统一管理 Harness 重启。
- 设置打开时，右上角三个窗口按钮同步模糊并禁用。
- 改进重启、退出与更新任务的协调，优化“关于 MyDSH”布局。
- 修复插件安装的 pnpm 路径与损坏依赖恢复问题，清理旧版运行产物。

## MyDSH 0.0.2

1. 修复了若干bug
2. 优化了实际体验

## MyDSH 0.0.1 历史发布记录

首个 MyDSH Windows x64 桌面发布。

- 统一桌面软件、托盘、启动页、安装器名称与图标为 MyDSH。
- 恢复上游主界面名称，保留两个自定义品牌图标、标题栏和本地模型设置。
- 修复设置顶部裁切及标题栏下方白缝，打开设置时标题栏同步模糊。
- 修复旧 profile 中 React、Zod、Schemastery 被列为独立插件的冗余登记。
- 插件市场不预装，提供按需安装、检测更新和更新功能。
- 移除上游 Harness 自动/手动更新入口，只保留 MyDSH 桌面更新。
- 保留现有会话与配置目录 `~/.minke`。
- 修复 Windows 短路径与目录别名导致的插件事务误拒绝，保留越界与链接安全检查。

## 安装前

需要 Windows x64、Node.js 24+、Corepack/pnpm 11.7.0 和系统 DSH `0.1.5-rc.2`，且相关命令可从 PATH 找到。安装器不包含这些运行环境。
配置 DSH 的命令：

```powershell
pnpm add --global @deepseek-ai/dsh@0.1.5-rc.2 --config.node-linker=hoisted --config.enable-global-virtual-store=false
```

安装包没有代码签名，Windows 可能显示未知发布者或信誉提示；请核对下载源及 SHA256SUMS。
本项目为社区桌面端，非 DeepSeek 官方产品。基于 Minke 与 DeepSeek Harness，保留上游许可声明。
