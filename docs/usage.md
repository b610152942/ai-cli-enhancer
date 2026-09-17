# 使用手册

## 显示内容

各 CLI 使用自身稳定的原生扩展点，不强求完全相同的外观，但优先显示当前对话的关键状态。

| CLI | 底栏内容 |
| --- | --- |
| Agy | 状态、实时或 metadata 会话标题；标题未生成时显示短 `sid`，全新会话显示 `new`；模型、当前目录、context token/百分比、Git、agent 数、危险权限 |
| CodeBuddy | 状态、标题/短 session ID、当前目录、模型、context、Git、agent 数、危险权限 |
| Claude | 状态、会话标题/短 session ID、当前目录、模型、精确 context、Git、agent 数、危险权限 |
| Codex | 原生 run state、thread title、current dir、Git、模型/推理、context、used tokens、task progress、permissions |
| Gemini | 原生当前目录、Git、模型、context、session ID、sandbox；labels 使用当前主题颜色 |
| Pi | session name/短 ID、当前目录、模型、context、会话累计 used tokens、Git |

字段只在 CLI 提供真实数据时显示。Agy 标题只按完整 session ID 查询其结构化 metadata，不读取 `history.jsonl`、会话数据库消息或对话正文；增强器也不会扫描历史记录估算 token。

## 自适应布局

Agy 空间充足时使用单行：

```text
[RUN] Fix auth | 3.8 Flash High | cwd api-server | ctx 25k/1M (3%) | main | agents 2
```

终端较窄时自动拆为两行：

```text
[RUN] Fix auth | 3.8 Flash High
cwd api-server | ctx 25k/1M (3%) | main | agents 2
```

其他 CLI 由各自 TUI 决定截断、折行或隐藏低优先级字段。

## 配色

- `READY` 绿色、`RUN` 青色、`WAIT` 黄色、`ERROR` 红色。
- 模型使用强调色，当前目录和分隔符使用弱化色。
- context 低于 70% 为绿色，70% 起为黄色，90% 起为红色。
- dirty Git 和高风险权限使用警示色，agent 数使用辅助强调色。
- Pi 跟随当前 Pi theme；Codex 和 Gemini 使用各自原生 theme。
- 设置环境变量 `NO_COLOR=1` 可关闭 Agy、CodeBuddy、Claude 和 Pi 的自定义配色。

## 状态含义

- `READY`：当前可接受输入。
- `RUN`：模型、工具或后台任务正在执行。
- `WAIT`：等待输入、确认或权限处理。
- `ERROR`：CLI 提供了错误或失败状态。
- `ctx 25k/1M (3%)`：当前上下文约使用 25,000 token，总窗口 1,000,000，按 CLI 数据取整为 3%。
- `used 40k`：会话累计 token；目前主要由 Pi 或 Codex 原生能力提供。
- `main*`：当前 Git 分支为 `main`，`*` 表示工作区有未提交修改。

## 管理命令

查看状态：

```powershell
.\enhance.ps1 status -Target windows,wsl
```

临时停用与恢复：

```powershell
.\enhance.ps1 disable -Cli agy -Target windows,wsl
.\enhance.ps1 enable -Cli agy -Target windows,wsl
```

升级全部已安装项或指定项：

```powershell
.\enhance.ps1 upgrade -Target windows,wsl
.\enhance.ps1 upgrade -Cli codex,agy -Target windows,wsl
```

执行管理命令后应重启对应 CLI。正在运行的会话通常不会重新加载底栏配置。

## 运行边界

- 不包装 CLI 启动命令，不接管 stdin。
- 不改变 agent 调度、后台任务和权限决策。
- hook 最长 3 秒并失败放行；Agy 的决策 hook 始终返回 `allow`。
- 没有常驻 daemon；Git 查询有缓存和硬超时。
- 普通完成、错误和权限通知不主动激活窗口，也不播放声音。
- `ask_question`、`agent_needs_input`、`elicitation_dialog` 等必须回答事件会立即显示停留更久的 `needs answer` Toast。增强器不自动聚焦窗口，避免 Windows 限制导致失焦或增加 hook 延迟。

## CLI 升级后的检查

通常 CLI 升级会保留用户配置。大版本如果更名状态字段、hook 事件或 package API，可能导致部分字段暂时不显示，但不应阻止 CLI 正常运行。

升级后执行：

```powershell
.\enhance.ps1 upgrade -Target windows,wsl
.\enhance.ps1 status -Target windows,wsl
```

然后重启 CLI。如果输出出现 `CONFLICT`，说明对应配置在安装后被其他程序或用户修改，增强器会保留当前值，不强制覆盖。

## 常见问题

### 底栏没有变化

1. 完全退出并重新启动 CLI。
2. 执行 `status` 确认对应 adapter 为 `enabled`。
3. 执行一次 `upgrade` 重新同步 runtime 和已管理配置。
4. 检查是否有 `CONFLICT` 输出。

### 某些字段没有显示

该 CLI 本轮没有提供对应字段，或终端宽度不足。标题、精确 token、agent 数等都不会通过读取历史记录来补算。

### 增强器异常会不会卡住 CLI

状态渲染异常会输出空内容；hook 有超时并失败放行。增强器不代理 CLI 进程，因此设计上只允许显示或通知降级。
