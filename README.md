# Ctags Navigator Lite

一个语言无关、低资源占用的 VS Code 定义跳转扩展。它读取工作区已有的经典格式 `tags` 或 `.tags`；也可由用户通过编辑器右键菜单调用本机的 ctags，在工作区根目录生成 `.tags` 文件。

## 功能

- 通过“Ctags Navigator: 跳转到当前符号定义”命令在任意文件类型中跳转；不接管 F12、Ctrl+单击或 Peek Definition。
- 从当前文件目录向上查找最近的 tags，边界为所属工作区根目录。
- 支持多根工作区、本地桌面、Remote SSH、WSL 和 Dev Container。
- 对已排序的 tags 使用 32 KiB 块和字节偏移二分查询，不把整个文件加载到内存。
- 支持数字地址、搜索地址、`line`、`kind` 和常见 scope 扩展字段。
- 识别 `.`、`::`、`->`、`#`、`/`、`\` 限定上下文并稳定排序候选。
- 找不到 tags、符号或候选时静默返回，不阻断其他语言扩展。
- 编辑器右键菜单提供“生成 Tags”入口，可在当前工作区根目录生成或更新 tags 文件。
- 扩展只在命令被调用时激活，打开窗口本身不产生任何开销。

## 准备 tags

扩展要求经典格式、按区分大小写的符号名排序。安装 Universal Ctags 并确保 VS Code 可以找到 `ctags` 后，点击编辑器右键菜单中的“生成 Tags”即可在当前文件所属工作区的根目录创建 tags，不会写入当前文件所在的子目录。多根工作区且没有活动编辑器时，会要求选择目标目录。生成的文件名取 `ctagsNavigator.tagFileNames` 的第一项（默认 `.tags`），因此改了配置也能立刻被查找到。

生成过程可以在通知上取消；单次生成超过 10 分钟会自动中止。默认排除 `.git`、`node_modules`、`dist`、`out`、`build`、`target`、`.vscode-test`。等价的手工命令是：

```bash
ctags --sort=yes --fields=+n --exclude=.git --exclude=node_modules --exclude=dist \
  --exclude=out --exclude=build --exclude=target --exclude=.vscode-test -R -f .tags .
```

支持 `!_TAG_FILE_SORTED=1`。未声明排序状态时会按已排序处理并写入诊断输出；值为 `0` 或 `2` 时会拒绝查询，不进行全文件线性回退。

## 配置

```json
{
  "ctagsNavigator.enabled": true,
  "ctagsNavigator.tagFileNames": [".tags", "tags"],
  "ctagsNavigator.maxResults": 50
}
```

`tagFileNames` 只接受文件名，不接受绝对路径、目录分隔符或 `..`。`maxResults` 有效范围为 1–200；无效配置会使用安全默认值。

## 命令

- `Ctags Navigator: 跳转到当前符号定义`：单个定义直接跳转，多个定义按“相对路径:行号”和目标行内容显示列表供选择，未找到定义时显示提示。扩展不提供默认快捷键；可在 VS Code 的“键盘快捷方式”中搜索此命令后自行绑定。
- `Ctags Navigator: 清理缓存`：清理定位、查询和地址缓存，并关闭 tags 文件句柄。
- `Ctags Navigator: 诊断当前符号`：按需打开输出通道，显示启用状态、符号、限定上下文、tags、排序状态、候选数量和耗时。
- `Ctags Navigator: 生成或更新 Tags`：调用本机安装的 ctags，在当前文件所属工作区的根目录生成 tags；生成过程可取消，未受信任的工作区不会执行此操作。右键菜单项只在受信任工作区的文本编辑器中出现。

## 资源与安全边界

- 空闲时无磁盘活动、定时器、监听器和子进程；仅在用户点击“生成 Tags”时启动一次 ctags 子进程，该进程带 16 MiB 输出上限、10 分钟超时，并随取消结束。
- 最多打开 4 个 tags 文件句柄；自有查询与地址缓存总计不超过 4 MiB。
- 搜索地址只执行还原转义后的精确行匹配，不作为 JavaScript 正则执行；无行号时最多流式扫描目标文件前 32 MiB。
- 单次请求最多尝试解析 200 个候选，且指向同一目标文件的候选合并为一次顺序扫描，不会各自从文件头重扫。
- 记录同时带行号和搜索地址时会校验该行内容，不一致（tags 已过期）则按搜索地址重新定位。
- 扩展不执行项目代码；生成 Tags 仅在受信任工作区中调用 `ctags`，并使用固定参数而非 shell 命令字符串。

## 开发

```bash
npm install
npm test
npm run lint
npm run build
npm run test:integration
```

生产 bundle 位于 `dist/extension.js`，不包含运行时 npm 依赖。执行 `npm run package` 可生成 VSIX。

## 第一版不包含

自动后台生成或更新 tags、JSON tags、LSP/AST/Tree-sitter、引用、重命名、补全、诊断、语言特定规则及 Web 版 VS Code。
