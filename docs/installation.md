# 安装手册

## 环境要求

- Windows PowerShell 5.1 或 PowerShell 7。
- Windows 和需要增强的 WSL 发行版均安装 Node.js 20 或更高版本。
- 目标 AI CLI 已能独立正常启动。增强器不会安装或替代 AI CLI 本体。
- 同时安装 WSL 时，默认发行版名称为 `Ubuntu-24.04`；不同名称需传入 `-WslDistro`。

安装前可检查：

```powershell
node --version
wsl.exe -d Ubuntu-24.04 -- node --version
```

## 获取代码

```powershell
git clone git@codeup.aliyun.com:667d24b4375bb2acf8b3123c/utils/ai-cli-enhancer.git D:\ai-coding\ai-cli-enhancer
cd D:\ai-coding\ai-cli-enhancer
```

## 推荐安装

在 Windows PowerShell 中执行：

```powershell
.\enhance.ps1 install -Cli core,pi -Target windows,wsl
```

`core` 等于 `agy,codebuddy,claude,codex,gemini`。该命令会安装全部当前支持项：Agy、CodeBuddy、Claude Code、Codex、Gemini CLI 和 Pi。

只安装部分 CLI：

```powershell
.\enhance.ps1 install -Cli agy,codex -Target windows,wsl
.\enhance.ps1 install -Cli claude,codebuddy -Target windows
.\enhance.ps1 install -Cli pi -Target wsl
```

使用其他 WSL 发行版：

```powershell
.\enhance.ps1 install -Cli core,pi -Target windows,wsl -WslDistro Ubuntu
```

## 安装位置

| 目标 | 增强器文件 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\AI-CLI-Enhancer` |
| WSL | `~/.local/share/ai-cli-enhancer` |

安装器只管理明确记录的配置键、带唯一标记的 hook 和 Pi package。它不会复制密钥、登录信息、会话内容或历史记录。

## 验证安装

```powershell
.\enhance.ps1 status -Target windows,wsl
```

目标 CLI 应显示为 `enabled`。随后完全退出并重新启动 CLI，让其重新读取用户配置。

也可以执行项目验证：

```powershell
npm test
npm run check
```

## 第二台电脑

在另一台电脑重复“获取代码”和“推荐安装”。每台电脑会生成自己的安装状态与回滚记录；仓库中不包含本机路径、账号、密钥或会话数据。

## 已安装后的升级

拉取增强器新版本后执行：

```powershell
git pull
.\enhance.ps1 upgrade -Target windows,wsl
.\enhance.ps1 status -Target windows,wsl
```

升级 AI CLI 本体后也建议重新执行 `upgrade`，再重启该 CLI。若新版本更改了配置协议，增强器会尽量保持失败静默，不阻断 CLI 主流程。
