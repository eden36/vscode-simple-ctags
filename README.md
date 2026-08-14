# simple ctags

一个语言无关、低资源占用的 VS Code 定义跳转扩展。读取工作区已有的经典格式 `tags` / `.tags`，也可通过右键菜单调用本机 ctags 生成 `.tags`。

源代码仓库：<https://github.com/eden36/vscode-simple-ctags>

## 功能

- 通过“simple ctags: 跳转到当前符号定义”命令跳转，不接管 F12、Ctrl+单击或 Peek Definition。
- 从当前文件目录向上查找最近的 tags，边界为所属工作区根目录。支持多根工作区、Remote SSH、WSL 和 Dev Container。
- 对已排序的 tags 使用 32 KiB 块和字节偏移二分查询，不把整个文件加载到内存。
- 支持数字地址、搜索地址、`line`、`kind` 和 scope 扩展字段；识别 `.`、`::`、`->`、`#`、`/`、`\` 限定上下文并稳定排序候选。
- 找不到 tags、符号或候选时静默返回，不阻断其他扩展。
- 右键菜单提供“生成 Tags”入口，在工作区根目录生成或更新 tags 文件。
- 只在命令被调用时激活，空闲时无任何开销。

## 准备 tags

安装 Universal Ctags 并确保 VS Code 可以找到 `ctags`，点击编辑器右键菜单中的“生成 Tags”即可在当前文件所属工作区的根目录生成 tags。生成的文件名取 `simpleCtags.tagFileNames` 的第一项（默认 `.tags`）。生成时通知会以固定行数逐行显示 ctags 最近的输出，长行会截断以避免通知尺寸变化，扩展不会自动打开输出面板；生成过程可取消，超 10 分钟自动中止。默认排除 `.git`、`node_modules`、`dist`、`out`、`build`、`target`、`.vscode-test`。等价手工命令：

```bash
ctags --sort=yes --fields=+n --exclude=.git --exclude=node_modules --exclude=dist \
  --exclude=out --exclude=build --exclude=target --exclude=.vscode-test -R -f .tags .
```

扩展要求 tags 按区分大小写的符号名排序。支持 `!_TAG_FILE_SORTED=1`；未声明时按已排序处理；值为 `0` 或 `2` 时拒绝查询，不做全文件线性回退。

## 配置

```json
{
  "simpleCtags.enabled": true,
  "simpleCtags.tagFileNames": [".tags", "tags"],
  "simpleCtags.maxResults": 50
}
```

`tagFileNames` 只接受文件名；`maxResults` 范围 1–200。无效配置使用安全默认值。

## 命令

| 命令 | 说明 |
|------|------|
| `simple ctags: 跳转到当前符号定义` | 单结果直接跳转，多结果按“相对路径:行号”和目标行内容选择。无默认快捷键，见下文「绑定快捷键」。 |
| `simple ctags: 清理缓存` | 清理缓存并关闭 tags 文件句柄。 |
| `simple ctags: 诊断当前符号` | 打开输出通道，显示符号、上下文、候选和耗时。 |
| `simple ctags: 生成或更新 Tags` | 调用本机 ctags 生成 tags；仅在受信任工作区可用。 |

## 绑定快捷键

扩展不提供默认快捷键，需自行绑定。以“跳转到当前符号定义”为例，在 `keybindings.json` 中添加：

```json
{
  "key": "alt+d",
  "command": "simpleCtags.goToDefinition",
  "when": "editorTextFocus"
}
```

也可按 `Ctrl+K Ctrl+S` 打开键盘快捷方式设置，搜索 `simple ctags` 后点击加号绑定。其他命令 ID：`simpleCtags.clearCache`、`simpleCtags.diagnoseCurrentSymbol`、`simpleCtags.generateTags`。

## 资源与安全边界

- 空闲时无磁盘活动、定时器、监听器和子进程；仅在“生成 Tags”时启动一次 ctags 子进程（16 MiB 输出上限、10 分钟超时、可取消）。
- 最多 4 个 tags 文件句柄；查询与地址缓存总计不超过 4 MiB。
- 搜索地址只做精确行匹配，不作为正则执行；无行号时最多扫描目标文件前 32 MiB。
- 单次请求最多解析 200 个候选，同一目标文件的候选合并为一次扫描。
- 不执行项目代码；生成 Tags 仅在受信任工作区用固定参数调用 `ctags`。

## 开发

```bash
npm install
npm test        # 类型检查 + 单元测试
npm run lint
npm run build
npm run test:integration  # 需要图形环境
npm run package          # 生成 VSIX
```

## 第一版不包含

自动后台生成或更新 tags、JSON tags、LSP/AST/Tree-sitter、引用、重命名、补全、诊断、语言特定规则及 Web 版 VS Code。
