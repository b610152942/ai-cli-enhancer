# 卸载手册

## 临时停用

暂时不需要某个增强时优先使用 `disable`：

```powershell
cd D:\ai-coding\ai-cli-enhancer
.\enhance.ps1 disable -Cli agy -Target windows,wsl
```

这会恢复该 CLI 安装前的受管配置，但保留增强器文件和回滚元数据。恢复使用：

```powershell
.\enhance.ps1 enable -Cli agy -Target windows,wsl
```

## 卸载单个 CLI

```powershell
.\enhance.ps1 uninstall -Cli codebuddy -Target windows,wsl
```

可以一次卸载多个：

```powershell
.\enhance.ps1 uninstall -Cli agy,claude,codex -Target windows,wsl
```

共享 runtime 仍被其他 adapter 使用时会保留，不影响其他 CLI。

## 完整卸载

```powershell
.\enhance.ps1 uninstall -All -Purge -Target windows,wsl
```

该命令会：

- 恢复仍由增强器持有的配置值。
- 删除带增强器唯一标记的 hook。
- 移除 Pi 的 `ai-cli-enhancer` package。
- 清理未被用户修改的 runtime、package 文件和安装状态。

它不会删除 AI CLI 本体、账号、密钥、会话或项目文件。

## 验证卸载

```powershell
.\enhance.ps1 status -Target windows,wsl
```

完全退出并重启对应 CLI，确认底栏恢复到原始状态。

## `CONFLICT` 的处理

如果某个受管值在安装后被手工或由 CLI 修改，卸载器会报告 `CONFLICT` 并保留当前值，避免覆盖用户修改。此时：

1. 记录冲突提示中的文件和配置键。
2. 确认该值是否仍指向 `AI-CLI-Enhancer` 安装目录。
3. 只有确认不再需要时，才手工删除对应键或 hook。

不要直接删除整份 `.claude`、`.codex`、`.gemini` 或 `.codebuddy` 配置文件，其中可能包含与增强器无关的用户设置。

## 删除源码仓库

先完成 `uninstall -All -Purge`，再删除源码目录。安装采用文件复制，正常卸载不依赖源码目录长期存在；但保留源码便于后续升级、重新启用和在第二台电脑安装。
