# OpenBot

[English](README.md) | 简体中文

[![CI](https://github.com/nightly-labs/openbot/actions/workflows/ci.yml/badge.svg)](https://github.com/nightly-labs/openbot/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-blue.svg)](LICENSE)

OpenBot 是一个本地优先的桌面工作区，为持久的 AI 队友而建。它支持本地
[Codex App Server](https://learn.chatgpt.com/docs/app-server) 与
[Claude Code](https://code.claude.com/docs/en/overview)，并可通过 ACP 接入
[Grok CLI](https://docs.x.ai/build/overview)、OpenCode、Gemini、[Cursor CLI](https://cursor.com/cli)
和 [Cline CLI](https://cline.bot/cli)。它为每个智能体提供独立的工作区与会话，并在同一个桌面应用中提供本地队列、
文件传输、内嵌浏览器以及智能体间消息传递。

> [!WARNING]
> OpenBot 目前处于开发预览阶段。智能体当前以 `danger-full-access` 与 `approvalPolicy: never` 模式运行。
> 在首次启动的显式同意之后，它们可以读取和修改文件、执行命令、访问网络并控制内嵌浏览器，而无需逐项确认。
> 只运行你信任的智能体和任务，做好备份，并在使用前阅读[安全](#安全)一节。

> [!NOTE]
> 本文档翻译自[英文 README](README.md)。OpenBot 迭代很快，如与英文版不一致，以英文版为准。
> 开发命令表变动频繁，本文件仅保留常用子集，完整参考见[英文 README 的 Commands 一节](README.md#commands)。

## 功能一览

- 在桌面端和移动端通过提示词创建和编辑智能体，可编辑指令、头像，并在保存前逐段审阅。
- 持久化智能体，背后是独立的 Codex、Claude、Grok、OpenCode、Gemini、Cursor 或 Cline 会话与本地工作区。
- 自定义 OpenAI 兼容端点和自定义 ACP 智能体，可探测本地模型服务（Ollama、LM Studio）与已安装的智能体。
- 每个智能体的上下文监控，在长对话耗尽模型窗口之前自动压缩。
- FIFO 消息队列，支持暂停、恢复、取消与崩溃安全的持久化。
- 智能体间消息、回复、表情回应、图片与托管的文件传输。
- 共享桌面频道聊天：单一任务负责人、显式委派、共享历史，以及停止、恢复、改派、归档与恢复控制。
- 一个持久的内嵌浏览器，智能体可以打开、检查并控制它。
- 可选的 Computer Use（电脑控制），覆盖 macOS、Windows 与 Linux，通过发布包中的 `cua-driver` 二进制提供，
  OpenBot 将它作为子进程启动并提供给每个 Provider。
- 每个智能体独立的模型、推理力度、档案、通知、浏览器与面板状态。
- 本地数据与隐私安全的诊断信息导出，入口在账户菜单。
- 可选的 OpenBot 账户，通过一次性邮箱验证码登录。账户 API 运行在 Cloudflare Workers 与 D1 上。

OpenBot 是本地优先，而非完全离线。Codex 连接 OpenAI，Claude 连接 Anthropic，Grok 连接 xAI，Gemini
连接 Google，Cursor 连接 Cursor，Cline 连接 Cline，访问过的网页会使用网络，已安装的插件也可能连接
它们各自的服务。

## 安装

OpenBot 支持 macOS 13 及以上版本（Apple 芯片或 Intel）、Windows 10 及以上版本（x64），以及 x64
或 arm64 的 Linux（AppImage）。

### macOS

1. 从 [GitHub Releases](https://github.com/nightly-labs/openbot/releases) 下载最新的
   `OpenBot-*-arm64.dmg`（Intel Mac 请下载 `OpenBot-*-x64.dmg`）。
2. 将 OpenBot 拖入「应用程序」并打开。

### Windows

1. 从 [GitHub Releases](https://github.com/nightly-labs/openbot/releases) 下载最新的
   `OpenBot-*-x64.exe`。
2. 运行安装程序并打开 OpenBot。

### Linux

1. 从 [GitHub Releases](https://github.com/nightly-labs/openbot/releases) 下载最新的
   `OpenBot-*-x86_64.AppImage`（arm64 请下载 `OpenBot-*-arm64.AppImage`）。
2. 用 `chmod +x OpenBot-*.AppImage` 添加执行权限后运行。

AppImage 不需要 libfuse2，因此也能在 Arch Linux 与 Omarchy 上运行。它会使用 `fuse3` 软件包中的
`fusermount3` 自行挂载。

在 Ubuntu 23.10 及以上版本和 Debian 13 上，非特权用户命名空间受 AppArmor 限制，OpenBot 在安装
AppArmor 配置文件之前会在启动时退出：

```bash
sudo install -m 0644 build/linux/openbot.apparmor /etc/apparmor.d/openbot
sudo systemctl reload apparmor
```

同一个文件也随 AppImage 附带在 `resources/linux/openbot.apparmor`。如果你把 AppImage 放在非常规
位置，请修改配置文件中的挂载路径。不要用 `--no-sandbox` 启动 OpenBot：那会移除渲染进程与计算机其余
部分之间的边界。

首次从 AppImage 启动时，OpenBot 会写入 `~/.local/share/applications/openbot.desktop` 与
`~/.local/share/icons/openbot.png`，这让 `openbot://` 链接（邀请或插件列表）能够打开应用，并给启动器
一个在应用退出后仍然保留的图标。删除这两个文件即可撤销。

远程桌面在 Linux x64 的 X11 会话（如 Xorg 或 Xvfb）中可用。Wayland 下不可用，arm64 AppImage 不包含
该功能。

Gemini 登录需要安装桌面浏览器和 `xdg-utils`。请在同一主机或虚拟机的桌面会话中打开登录页面。Google
会把回调通过 `127.0.0.1` 发回该主机；没有桌面的服务器无法完成此登录。参见
[Gemini 设置](docs/architecture/providers.md#gemini)。

#### 无屏幕的 Linux 服务器

要在 VPS 或家庭服务器上（Ubuntu 24.04 或 26.04，systemd）将 OpenBot 作为你账户的常驻服务器运行，
在终端中安装并用邮箱验证码登录：

```bash
curl -fsSL https://raw.githubusercontent.com/nightly-labs/openbot/main/scripts/install-server.sh | sudo bash
sudo openbot login
```

然后在桌面应用、iPhone 应用或 `openbot.run/app` 中使用。各项选项与 `openbot` 命令见
[自托管服务器](docs/self-hosted-server.md)。

#### Docker

同一个服务器也可以以容器方式运行（`linux/amd64` 与 `linux/arm64`）。下面的 seccomp 配置让 Electron
沙箱保持开启：

```bash
curl -fsSLO https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/seccomp.json
docker run -d --name openbot --restart unless-stopped \
  --security-opt seccomp=seccomp.json --security-opt no-new-privileges:true \
  --shm-size 1g --stop-timeout 60 -v openbot-data:/data \
  ghcr.io/nightly-labs/openbot:latest
docker exec -it openbot openbot login
```

Compose、数据卷、升级与安全限制见 [Docker](docs/docker.md)。Amazon ECS 见
[AWS ECS](docs/aws-ecs.md)。

### Nix

这个 flake 可以从最新发布版本安装桌面应用，支持 x64 或 arm64 Linux 以及 Apple 芯片 Mac：

```bash
nix run github:nightly-labs/openbot
nix profile install github:nightly-labs/openbot
```

`overlays.default` 添加了 `pkgs.openbot`。OpenBot 不是自由软件，你的 nixpkgs 需要允许安装它，例如
`nixpkgs.config.allowUnfreePredicate = pkg: lib.getName pkg == "openbot";`。Nix 负责安装 OpenBot
的更新；OpenBot 自己不会从 Nix store 更新。在 Linux 上，Nix 软件包不包含远程桌面运行时，因为
nixpkgs 缺少它需要的库。

> [!IMPORTANT]
> Windows 发布版本由 `SYNTHETIFY LABS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ` 签名。更早的发布
> 版本没有代码签名。SmartScreen 仍可能对新版本发出警告。运行安装程序前请核对发布校验和或 GitHub
> 构建证明（attestation）。

### Agent 设置

在引导流程、设置、智能体设置或模型选择器中选择 `Download` 时，OpenBot 可以下载受支持的 Provider
运行时。OpenBot 优先使用自己托管的 CLI；显式的 `OPENBOT_*_PATH` 覆盖优先，其次使用兼容的系统 CLI。
OpenBot 在启动时和每小时检查一次更新的 Provider CLI 发布版，Provider 操作菜单中的
`Check for updates` 则立即检查。更新会安装上游最新发布版，不会改动用户系统的 CLI；
`native-runtime.lock.json` 中的版本只是首次安装的回退值。

你也可以自行安装 CLI。

macOS 上的 Codex CLI：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

macOS 上的 Claude CLI：

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Grok CLI 按照 [Grok Build 文档](https://docs.x.ai/build/overview)安装，然后用 `grok login` 认证，
或在启动 OpenBot 的环境中设置 `XAI_API_KEY`。

OpenBot 会像 Codex、Claude 和 Grok 一样下载并钉住 OpenCode CLI。OpenCode 的免费模型不需要账户、
不需要登录：选择 OpenCode，点击 Connect，OpenBot 会读取该 CLI 宣告的模型。要使用付费的 OpenCode Go
模型，点击 OpenCode 行上的 Sign in，粘贴来自 [opencode.ai/auth](https://opencode.ai/auth) 的 Go
密钥。OpenBot 会在本机加密该密钥，并且只交给本地 CLI。OpenBot 只支持 OpenCode Go：Go 密钥不包含的
Zen 模型不会出现在选择器中。模型选择器里带 Free 标签的模型无需登录。其余模型需要向各自的 Provider
登录：`opencode-go/` 模型需要 Go 密钥，OpenCode Zen 与第三方 Provider 需要在终端执行
`opencode auth login`。没有登录时，该轮回合会以一个指名 Provider 的错误结束。如果你自己安装了
OpenCode，OpenBot 会保留你的安装，不再提供下载。设置 `OPENBOT_OPENCODE_PATH` 可以选择 shell 搜索
路径之外的可执行文件。远程 OpenCode 智能体需要 Team API v4；较旧的客户端不显示这些智能体。

Gemini 使用 Google AI Pro 或 Ultra 订阅。由于 Google 的许可不允许 OpenBot 随包分发，当你在 Gemini
行选择 Download 时，OpenBot 会在本机下载 Google 的 Antigravity ACP 服务器。登录会打开浏览器中的
Google 登录页。OpenBot 绝不会使用搜索路径上名为 `antigravity` 的命令，因为 Antigravity 编辑器会安装
同名命令。设置 `OPENBOT_ANTIGRAVITY_PATH` 可自行指定服务器可执行文件：把它放进一个 `bin/` 目录，并在
`bin/` 的上一级目录放一个包含其 `version` 的 `antigravity-package.json` 文件，同时把
`localharness_external` 放在该服务器旁边。设置该路径后，OpenBot 只使用它。主机的本地
Settings > Providers 页面仍可连接。远程设置无法完成 Google 登录；请使用主机上的浏览器。所需的目录
结构、已知的 IPv6 下载失败报告以及不改动主机网络的检查项，见
[Gemini 设置与下载恢复](docs/architecture/providers.md#gemini)。

Cursor 使用 Cursor 订阅或 Cursor API 密钥。当你在 More providers 的 Cursor 行选择 Download 时，
OpenBot 会下载并钉住 Cursor CLI（`cursor-agent`），并以 `cursor-agent acp` 启动。登录会打开浏览器中
的 Cursor 登录页。你也可以在启动 OpenBot 的环境中设置 `CURSOR_API_KEY`。如果你自己安装了
`cursor-agent`，在有下载可用之前 OpenBot 会使用你的安装。OpenBot 绝不使用会启动 Cursor 编辑器的
`cursor` 命令。设置 `OPENBOT_CURSOR_PATH` 可自行指定可执行文件。Cursor 智能体只留在本机：团队成员
看不到它们。

Cline 使用 Cline 账户，其中的免费模型有各自的用量限制。免费模型的 Provider 可能使用你的提示词训练
模型。当你在 More providers 的 Cline 行选择 Download 时，OpenBot 会下载并钉住 Cline CLI
（`cline`），并以 `cline --acp` 启动。登录会打开浏览器中的 Cline 登录页。你也可以在启动 OpenBot 的
环境中设置 `CLINE_API_KEY`。如果你自己安装了 3.0.68 或更新版本的 `cline`，在有下载可用之前 OpenBot
会使用你的安装。设置 `OPENBOT_CLINE_PATH` 可自行指定可执行文件。Cline 智能体只留在本机：团队成员
看不到它们。

在 Windows 上，请安装原生 CLI 并确保 `codex`、`claude` 或 `grok` 在 PowerShell 中可用。Claude Code
还需要 Git for Windows。然后认证已安装的 CLI 并重启 OpenBot。

使用已安装的发布版本时不需要 Bun 和 Node.js。可选的 Computer Use 支持 macOS、Windows 与 Linux，
发布包自带驱动，无需额外安装。只有 macOS 会为它请求权限：屏幕录制与辅助功能。

OpenBot 使用本地 CLI 既有的登录状态，不会复制 Provider 凭据。Grok 的 `XAI_API_KEY` 与每会话的 MCP
bearer 令牌不会被持久化或记录日志。各 Provider 的服务条款适用于你的登录。Claude 订阅相关条款见
[Provider 条款](docs/provider-terms.md)。

安装问题、数据重置与卸载说明见[故障排查](docs/TROUBLESHOOTING.md)。OpenBot 的数据与网络行为记录在
[隐私](PRIVACY.md)中。

## 开发

开发环境需要稳定的 [Bun](https://bun.sh/) 1.4.2、Node.js 24（`.nvmrc` 中的版本，与 Electron 内置的
Node 一致 —— 运行 `nvm use`），以及至少一个受支持的 agent CLI。

在 macOS 或 Linux 上安装指定版本的 Bun：

```bash
curl -fsSL https://bun.com/install | bash -s "bun-v1.4.2"
```

在 Windows 的 PowerShell 中安装：

```powershell
iex "& {$(irm https://bun.com/install.ps1)} -Version 1.4.2"
```

```bash
git clone https://github.com/nightly-labs/openbot.git
cd openbot
bun install --frozen-lockfile
bun run codex:doctor
bun run dev
```

`codex:doctor` 在不启动模型回合的情况下检查 CLI 版本、App Server 握手与 ChatGPT 登录状态。
`bun run cua-driver:doctor` 单独报告 Computer Use 驱动的状态。

在新的 git worktree 中运行 `bun run dev:bootstrap`。它会从主检出复制 `.worktreeinclude` 列出的缺失
文件、安装依赖、迁移本地 API，并为隔离 profile 播种数据。把它设置为你的 agent harness 的 worktree
初始化命令即可。

在 macOS 上，worktree 的 `node_modules` 几乎不占用新的磁盘空间：Bun 从缓存克隆软件包，根目录的
`postinstall` 从 `~/Library/Caches/OpenBot/electron-dist` 克隆 Electron。`du` 仍会显示每个克隆的
完整大小。某个 Electron 版本首次安装时会被解压一次并保存到该缓存；删除该目录即可清空缓存，30 天无人
使用的条目会在下次保存时被移除。

要只重置本地开发状态，请先退出开发应用与测试客户端，然后运行 `bun run dev:reset`。该命令删除应用与
测试客户端的开发 profile 以及旧版主机 profile，包括 `openbot.db` 及其 WAL 文件。删除前会打印每个
profile；当某个开发应用仍打开其中之一时，它什么也不删。它不会改动生产 profile、`bun run dev` 打开的
worktree profile（`OpenBot Dev wt-<hash>`）、智能体工作区、`~/.codex` 或 `~/.claude`。

`bun run dev` 会为它创建的开发 profile 播种数据，因此首次启动就能看到数据。`bun run dev:seed` 替换
共享的 `OpenBot Dev` profile。使用方法：退出开发应用后运行：

```bash
bun run dev:seed
bun run dev --shared
```

当本机的 OpenCode CLI 列出 `opencode-go/muse-spark-1.3-contributor` 时，播种的智能体以 medium
推理力度运行在它之上；否则运行在 low 力度的 `gpt-6-luna` 上。开发构建新建智能体时使用同一对组合，
因此播种的智能体与你新建的智能体行为一致；打包构建则始终使用 `gpt-6-luna`。

播种内容包括：智能体、丰富的会话、托管文件与引用、表情回应、已完成的智能体交互、两个带委派任务运行的
频道、频道记忆与例行任务，以及本地团队聊天数据。所有记录的时间都以运行时刻为基准向前推算，因此对话里
能看到 Today 与 Yesterday。它不添加活动队列项、进行中的例行运行或排队中的频道任务，因此不会启动任何
模型回合。用 `bun run dev:seed --dry-run` 可以在不改动文件的情况下查看目标与数据量。`dev:seed`、
`dev:reset`、`dev:verify`、`dev:bench` 与 `dev:automation` 在 `--help` 时打印用法并不改动任何内容；
遇到未知选项时以退出码 2 停止。

### Marketplace 启动目录

用 `bun run marketplace:seed:local` 在本地播种已批准的 OpenBot 团队目录，然后启动或复用
`bun run dev`。在 Marketplace 中搜索 **OpenBot** 即可查看其 Skills 与 Agents。该种子只添加目录
记录，不重置应用数据。

`bun run marketplace:build` 创建启动包。`bun run marketplace:publish:production` 是一次干跑；生产
写入需要显式标志和管理员凭据。参见[目录与发布指南](marketplace/production-catalog/README.md)。

技能作者可以在 `SKILL.md` 的 YAML frontmatter 中添加可选的 `example-prompt` 文本：

```yaml
example-prompt: Turn the latest commits into release notes.
```

技能预览会显示这段文本。**Try skill** 会把文本与一条技能引用追加到所选智能体的草稿中，不会发送消息。
该字段在去除首尾空白后最多接受 1,000 个字符。缺失或非法的值会使用默认示例。不需要新的包格式或数据库
迁移。

## 本地技能

让智能体从一个可复用的工作流创建技能。它会准备一个含 `SKILL.md` 的文件夹并调用 `create_skill`。技能
保存在共享的本地技能库中并为该智能体启用。其他智能体可以通过 **Settings → Skills → Local skills**
添加它。

智能体可以使用 `list_local_skills`、`read_local_skill`、`revise_skill` 与 `install_local_skill`。
修订需要智能体读到的版本号并保留历史版本。更新技能库中的技能不会更新已安装的副本：请使用 Update
标记或安装某个精确修订。被改动过的已安装文件会受到保护。要发布本地技能，请将技能文件夹单独通过
marketplace 提交。

可选的脚本、参考资料与资源遵循 Codex 技能文件夹结构。`assets/icon.png` 中的 PNG 图片作为本地预览
logo。内置的 `openbot-skill-creator` 指南说明了格式与校验限制。注册技能不会运行其中的脚本。

## 从 Grok Bot 导入智能体

在本机的 **Server settings → Import** 打开，或在桌面应用或浏览器客户端中已加入的服务器上打开。服务器的
每个成员都可以导入，不限于所有者或管理员。把 [OpenBot 导出智能体](https://x.ai/bot/gI0XdhhDYPJeyQaqQBC0O)
加入你的 Grok Bot，对它说 "Export my agents for OpenBot"。它会把一个 `.zip` 文件保存到 Downloads。
在 OpenBot 中选择该文件，挑选智能体并导入。

导入会带来每个智能体的名称、指令、头像、技能、例行任务与记忆。如果包含工作区文件，它们会被复制到该
智能体工作区的 `imported/` 目录。聊天历史不会被复制：导出智能体把重要事实保存为记忆。在本机上，文件
只在本机读取、不会上传。对已加入的服务器，文件（最大 100 MB）通过加密的主机连接传送到运行该服务器的
计算机。成员的导入使用服务器已有的技能，而不是更改它。导出技能及其格式见
[`resources/agent-import/grok-bot/SKILL.md`](resources/agent-import/grok-bot/SKILL.md)。

## 命令（Commands）

> OpenBot 迭代很快，开发命令表随每个版本频繁变动。为避免翻译滞后产生误导，完整的命令参考保留在
> [英文 README 的 Commands 一节](README.md#commands)，此处仅保留最常用的子集：

| 命令 | 用途 |
| --- | --- |
| `bun run dev` | 启动本地开发栈：Auth API、Signal 服务与带渲染层 HMR 的 Electron 客户端 |
| `bun run dev:seed` | 用持久的展示数据替换应用开发 profile |
| `bun run dev:reset` | 删除本地应用、测试客户端与旧版主机的开发状态 |
| `bun run dev:stop` | 停止本 worktree 的开发栈（含子进程） |
| `bun run check` | 运行 Biome、全部类型检查、离线测试、浏览器冒烟测试与生产构建 |
| `bun run test:desktop` | 运行桌面端测试（vitest） |
| `bun run typecheck` | 并行检查全部 15 个项目 |
| `bun run package` | 为本机的处理器架构构建未打包的本地应用 |

## macOS 远程桌面权限

对每一个 macOS 账户，请登录其 GUI 会话并打开 **Server Settings → Remote desktop access**。选择
**Check again** 读取 Sunshine 的屏幕录制与辅助功能权限、显示器可用性与 GUI 会话状态。该面板会列出
运行 Sunshine 的 Mac 与账户。请在那个账户里授予权限，包括用租户初始化脚本创建的账户。

在 Mac 上发布服务器后，会弹出可选的 **Set up remote desktop** 提示并打开此面板。选择 **Later**
可以在不配置远程桌面的情况下继续使用已发布的服务器。

使用权限按钮打开主机上的 **System Settings → Privacy & Security**。如果列表里没有 Sunshine，选择
**Show Sunshine in Finder** 并用 **+** 按钮添加随包附带的 `Sunshine.app`。macOS 可能把访问归因到
启动 Sunshine 的应用程序；请在系统提示时同时启用它指名的应用。然后回到 OpenBot 再次检查。如果需要
重启，请先结束远程会话。检查本身绝不会重启活动会话。

选择 **Test on this Mac** 进行本机测试。原生检查不可用时，它只测试视频并禁用观看端输入。检查通过
后，还可以测试鼠标与键盘。在另一台计算机上选择 **Test remote desktop** 进行远程测试。该测试要求远程
桌面主机当前未被占用。它会打开一个临时的主机面板，把远程输入限制在面板之内，并要求你点击一个目标并
输入四位数字码。确认画面可见后选择 **Finish test**。本机输入无法通过鼠标或键盘测试。面板在两分钟后
过期。较旧的主机或原生运行时需要更新后才能使用这些检查。

原生运行时源码变更会使旧的产物钉住（pin）失效。**Remote desktop runtime** CI 工作流会构建并测试新
源码，然后经由既有的发布流程发布并钉住验证过的产物。不要把旧的产物哈希与新源码摘要混用。

## 架构

```text
Electron main
├── local Codex App Server process over stdio JSONL
├── local Claude Agent SDK session over stream JSON
├── SQLite command log and read projections
├── secure typed IPC handlers
└── sandboxed WebContentsView browser host
    ↕ typed preload bridge
SolidJS renderer

Cloudflare Workers
└── TanStack Start + Solid 2 account API
    ├── D1 accounts, email challenges, hashed sessions, and team tunnels
    └── R2 account avatars
```

- `src/main` 负责 Electron 生命周期、窗口安全、本地协议与 IPC 注册。
- `src/backend` 负责 Provider 适配器、持久化、消息调度、传输与浏览器宿主。
- `src/preload` 只暴露类型化的 `window.openbot` API。
- `src/renderer` 是 SolidJS 界面。
- `apps/auth-api` 是 TanStack Start 账户 API：一次性邮箱验证码、限流与 D1 迁移。它同时承载公共站点：
  落地页、`/news`、`/guides`，以及 `/plugins` 与 `/plugins/<slug>` 的插件页面。
- `apps/status` 是 `status.openbot.run` 的公共状态页、`status-page` 工作流运行的服务检查脚本，以及
  发送团队[状态 webhook](docs/status-webhooks.md) 的脚本。它由 GitHub Pages 托管，因此 Cloudflare
  不可用时依然在线。
- `packages/contracts` 包含进程边界契约、共享限制与纯校验逻辑。
- `packages/i18n` 包含桌面、Web 与移动端的界面文本，覆盖英语、法语、日语、巴西葡萄牙语等语言。添加
  文本或语言见 [docs/i18n.md](docs/i18n.md)。

依赖方向、状态归属与新模块规则见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 聊天附件

通过文件选择器或拖放附加 MP3 音频与 MOV 视频。限制为每文件 100 MB、每条消息 250 MB、每条消息 10 个
文件。OpenBot 把原始文件交给智能体；导入过程中不会播放、解码、转写或校验录音。损坏的录音也可以附加
供检查。分析效果取决于智能体可用的工具。其他音视频格式请先导出为 MP3 或 MOV，或附加文字稿。远程主机
必须宣告 `media-attachments` 能力；功能不可用时请更新主机。

ZIP 压缩包适用同样的限制。OpenBot 不会解包或检查压缩包：智能体拿到原始文件并用它自己的工具解压。
智能体通过 `openbot.attach_files_to_response` 回传 ZIP 压缩包，用户在聊天中下载。Open 打开 ZIP 时
是在文件管理器中查看，而不是解包。远程主机必须宣告 `zip-attachments` 能力。

## 本地数据与网络边界

- `~/OpenBot/Agents/<agent-id>` — 每个智能体一个工作目录。在 bot 改名为 agent 之前写入的 profile
  把它们放在 `~/OpenBot/Bots` 下；应用会在首次启动时移动它们，无法移动的工作区保持原位且仍可读取。
- `~/OpenBot/Shared` — 有意在智能体之间共享的文件。
- `~/OpenBot/Shared/Transfers` — 托管的消息快照与生成的文件。每个传输都有 `.openbot-transfer.json`
  清单，记录所有权、接收者、大小与 SHA-256 元数据。
- `~/OpenBot/Downloads` — 内嵌浏览器的下载。
- Electron `userData/openbot.db` — OpenBot 的权威事件日志与读取投影：智能体、会话、Provider 会话
  绑定、队列、表情回应与附件索引。
- Electron `userData/legacy-backup-v1` — 迁移前存在的 `bots.json` 与 `mailbox.json` 的原样备份。
- `~/Library/Application Support/OpenBot/provider-runtimes` — OpenBot 下载并钉住的 Provider CLI。
  全机共享同一个存储，位于任何 profile 之外，因此每个开发 profile 与打包应用读取同一份下载。
  `--user-data-dir` 会把存储改放到该目录下，使显式命名的 profile 保持自包含。
- `~/.codex` — 登录与线程历史，完全由 Codex CLI 管理。
- `~/.claude` — 登录与会话历史，完全由 Claude CLI 管理。
- `~/.grok` — 登录与会话历史，完全由 Grok CLI 管理。
- `~/.gemini`（或 `$GEMINI_HOME`）— 登录与会话历史，完全由 Gemini 使用的 Antigravity ACP 服务器管理。
- `~/.cursor` — 登录与会话历史，完全由 Cursor CLI 管理。受约束的 Cursor 进程把设置保存在
  `~/.cursor/openbot-confined`，绝不会改动你自己的设置。
- `~/.cline`（或 `$CLINE_DIR`）— 登录与会话历史，完全由 Cline CLI 管理。

删除一个智能体会删除其工作区、它拥有的生成附件，以及仅发送给它的投递。当同一消息仍被其他智能体使用
时，该传输会保留。

当智能体在 Codex、Grok 与 Claude 之间切换时，OpenBot 保持同一条稳定的本地会话。Provider 原生的会话
标识保持私有，只用于恢复 Provider 运行时状态。

Electron 渲染进程永远不会作为公共网站暴露。它通过 stdio 与本地 CLI 进程通信。当所有者发布 OpenBot
时，其经过认证的 Team API 保持在 localhost 上。WebRTC 协议 v3 把 RPC、事件与二进制文件送达桌面与
移动客户端。Expo Go 在一个隐藏的 Expo DOM 组件中承载移动端的 `RTCPeerConnection`，因此移动端无需
自定义原生开发构建即可使用同一加密传输。账户流程连接到配置的 HTTPS Cloudflare API。客户端只保存加密
的 OpenBot 会话令牌。一次性验证码 10 分钟后过期，且只以哈希形式存储。每日维护任务会从 D1 中清除过期
或已消费的认证记录。内嵌浏览器使用独立的沙箱 Electron 会话，无法访问 `window.openbot` 或托管的本地
附件。

要运行自己的账户服务、Signal 与 TURN，参见[自托管远程访问](docs/self-hosting.md)。

要从外部服务触发例行任务，参见 [Webhooks](docs/webhooks.md)。公共 webhook 请求要求主机在线。

## 安全

报告漏洞前请先阅读 [SECURITY.md](SECURITY.md)。不要在公开 issue 中放入凭据、私密文件、会话内容或
敏感诊断信息。

完全的本地访问是当前明确的产品决策，而不是安全边界。以下情形的报告尤其有价值：远程内容能够触及
Electron 特权、托管附件路径能够逃出其根目录、IPC 发送方校验能够被绕过，或智能体能够越出上述描述的
访问范围行事。

## 发布

发布由标签驱动。`bun run release:patch`、`release:minor` 或 `release:major` 准备版本号与变更日志。
评审通过后提交、preflight 并打标签；推送标签会在 GitHub Actions 中构建已签名与公证的 macOS ARM64
和 x64 发布、已签名的 Windows x64 发布，以及未签名的 Linux x64 和 arm64 AppImage。发布发布后，该
工作流会把 Docker 镜像推送到 `ghcr.io/nightly-labs/openbot`。
已安装的构建会检查 GitHub Releases 的更新，并在账户弹窗中提供下载/重启控件。发布签名密钥与完整流程
记录在 [docs/RELEASING.md](docs/RELEASING.md)。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。在合并外部贡献之前，组织之外的每位作者需要签署
[贡献者协议（CLA）](CLA.md)，将贡献的著作权转让给 Synthetify Labs。社区行为准则见
[Code of Conduct](CODE_OF_CONDUCT.md)。

## 许可与署名

Copyright 2026 Synthetify Labs spółka z ograniczoną odpowiedzialnością.

基于 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权。你可以出于允许的非商业目的使用、修改并
分发代码。商业使用需要向版权所有者取得单独许可。商业授权请联系
[licenses@openbot.run](mailto:licenses@openbot.run)。0.1.11 及更早版本仍以 Apache-2.0 提供。
署名与第三方声明见 [NOTICE](NOTICE)。

OpenBot 是一个独立的 source-available 项目，与 OpenAI 没有任何隶属、背书或赞助关系。OpenAI、
ChatGPT 与 Codex 仅用于描述与相应产品的兼容性。

### 共享 macOS 主机

为每个租户提供一个原生 Standard 用户：在同一发布版本中安装常规 OpenBot DMG 和可选的
`OpenBot-Host-<VERSION>-arm64.pkg`。Host 软件包提供 `sudo openbot-host setup --create-user
client-acme --create-user client-bravo` 与 `sudo openbot-host verify`。`sudo openbot-host status
[--json]` 与 `sudo openbot-host watch` 显示更新阶段、暂存版本与每个租户的工作状态。主机上不需要
Git 检出、Bun 或编译。普通桌面用户只需要 DMG。既有用户加入、密码处理、软件包升级与目标主机检查见
[主机部署指南](docs/multi-tenant-hosting.md)。
