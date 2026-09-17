# AI CLI Enhancer

面向 Windows + WSL 的轻量 AI CLI 显示与通知增强包。第一版支持：

- Agy
- CodeBuddy
- Claude Code
- Codex
- Gemini CLI
- Pi

暂不处理 Hermes（原生显示已足够）、Grok、Coze、OpenCode、Qwen 和 Kimi。

## 设计边界

本项目只使用各 CLI 已公开的状态栏、footer、hook 或 package 扩展点：

- 不包装或代理 CLI 启动命令。
- 不接管 stdin、agent 调度、后台任务或权限决策。
- hook 最长 3 秒；普通提交只写轻量状态，不启动通知进程。需要通知时有 2.5 秒硬超时，增强失败会静默返回成功。
- Agy 的 `PreToolUse` hook 始终返回 `allow`，不改变工具调用结果。
- 不读取或同步 API Key、账号、会话、历史记录和整份用户配置。
- 没有常驻 daemon；状态栏每次只读取一次输入，Git 信息最多每 5 秒刷新一次并有 180ms 超时。
- 通知使用 Windows 原生 Toast，不创建 Tk 窗口、不调用 `focus_force()`、不激活 CLI 窗口，也不播放声音。
- 普通完成仅在运行至少 30 秒且当前前台不是终端/编辑器工作窗口时通知；等待输入和错误会立即通知，同会话同类事件 30 秒内去重。

所有增强均不使用配色。Agy 使用两行固定关键信息区：

```text
[RUN] Fix auth | 3.8 Flash High
cwd api-server | ctx 25k/1M (2%) | develop* | agents 2
```

第一行固定保留状态、会话和模型，第二行固定保留当前目录与上下文；Git 分支、agent 数和危险权限按终端宽度追加。不会按模型名称猜测上下文窗口，也不常驻显示费用。
Agy 会显示会话标题（新会话显示 `new`）、当前目录、精确上下文 token 与占用百分比、Git 分支、agent 数和紧凑模型名。

会话标识与 token 只使用 CLI 明确提供的字段：Agy/Claude 显示原生会话标题，Pi 显示正式 session name，Codex 使用原生 thread title，CodeBuddy/Gemini 在没有标题接口时显示会话 ID。可取得精确上下文 token 时显示 `ctx 24k/200k (12%)`；百分比缺失时仅根据 CLI 提供的 token 与窗口大小计算。Pi 显示会话累计，Codex 显示原生 token 用量。增强器不会读取对话正文来生成标题，也不会扫描历史记录补算 token。

当前能力：

| CLI | 显示增强 |
| --- | --- |
| Agy | 状态、标题/`new`、当前目录、精确 context 与百分比、Git、agent 数、紧凑模型、危险权限 |
| CodeBuddy | 状态、标题或短 session ID、当前目录、模型、context、Git、agent 数、危险权限 |
| Claude | 状态、会话标题、当前目录、模型、精确 context、Git、agent 数、危险权限 |
| Codex | 原生 run state、thread title、Git、模型/推理、context、used tokens、task progress、permissions；终端标题含 thread title 和项目名 |
| Gemini | 原生 Git、模型、context、session ID、sandbox |
| Pi | session name/短 ID、当前目录、模型、精确 context、会话累计 used tokens、Git |

## 安装

前置条件：Windows 和目标 WSL 中均已安装 Node.js 20+；只安装某个 CLI 时，该 CLI 本身也应已安装。PowerShell 入口会分别调用 Windows Node 与 WSL Node。

```powershell
cd D:\ai-coding\ai-cli-enhancer
.\enhance.ps1 install -Cli core,pi -Target windows,wsl
```

`core` 等于 `agy,codebuddy,claude,codex,gemini`。也可以只装一个：

```powershell
.\enhance.ps1 install -Cli codex -Target windows,wsl
.\enhance.ps1 install -Cli claude,codebuddy -Target windows
```

默认安装目录：

- Windows：`%LOCALAPPDATA%\AI-CLI-Enhancer`
- WSL：`~/.local/share/ai-cli-enhancer`

安装使用文件复制，不依赖 Git 工作区长期存在。配置所有权如下：

| CLI | 安装方式 | 管理内容 |
| --- | --- | --- |
| Agy | 配置 + 命名 hook | `statusLine`、`~/.gemini/config/hooks.json` 中的 `ai-cli-enhancer` |
| CodeBuddy | 配置 + hook | `statusLine` 和带唯一命令标记的 hook 项 |
| Claude | 配置 + hook | `statusLine` 和带唯一命令标记的 hook 项 |
| Codex | 原生 TOML | 仅 `[tui]` 下 5 个键 |
| Gemini | 原生 JSON | footer 项和 terminal notification 设置 |
| Pi | 官方 package | `pi install ./ai-cli-enhancer`，package 位于各端自己的 `.pi/agent` |

## 管理与卸载

```powershell
.\enhance.ps1 status
.\enhance.ps1 disable -Cli codebuddy
.\enhance.ps1 enable -Cli codebuddy
.\enhance.ps1 uninstall -Cli codebuddy
.\enhance.ps1 upgrade
.\enhance.ps1 uninstall -All -Purge
```

- `disable`：恢复该 CLI 原配置，但保留安装文件和回滚元数据，之后可 `enable`。
- `uninstall`：只卸载指定 CLI。共享 runtime 仍被其他 adapter 使用时不会删除。
- `upgrade`：更新已安装 adapter；也可用 `-Cli` 指定。
- `uninstall -All -Purge`：卸载全部 adapter，并清理未被修改的共享文件。

安装器记录每个标量键的原值，hook 则按唯一标记增删。卸载时只有当前值仍等于本工具写入值才会恢复；如果安装后用户手工改过，该值会保留并显示 `CONFLICT`。已安装脚本被用户改过时也不会直接删除。

## 第二台电脑

将仓库推送到私有 Git 后，在另一台电脑克隆并执行同一安装命令即可：

```powershell
git clone <private-repository-url> D:\ai-coding\ai-cli-enhancer
cd D:\ai-coding\ai-cli-enhancer
.\enhance.ps1 install -Cli core,pi -Target windows,wsl
```

仓库只包含源码、模板和测试。本机安装状态、绝对路径、密钥、会话及用户配置不会进入 Git。每台电脑会根据自己的 HOME 和 `%LOCALAPPDATA%` 生成独立状态。

如果 WSL 的 `.claude`、`.codebuddy`、`.codex` 或 `.gemini` 链接到了 Windows 用户目录，安装器会识别为同一份物理配置：Windows adapter 持有唯一回滚记录，命令在 Windows/WSL 间自动选择可访问的 runtime 路径，避免两端相互覆盖。Pi 使用同一个相对 package 名，但两端各有自己的 package 文件。

## 开发验证

```bash
npm test
npm run check
git diff --check
```

也可在 WSL 直接调用安装器：

```bash
node src/installer.mjs status --target wsl
node src/installer.mjs install --target wsl --cli core,pi
```
