# Ctags Navigator Lite

一个语言无关、低资源占用的 VS Code 定义跳转扩展。它只读取工作区已有的经典格式 `tags` 或 `.tags`，不运行 ctags、不扫描源码、不创建后台进程或文件监听器。

## 功能

- 通过“Ctags Navigator: 跳转到当前符号定义”命令在任意文件类型中跳转；编辑器聚焦时默认按 Ctrl+Alt+Y 执行；不接管 F12、Ctrl+单击或 Peek Definition。
- 从当前文件目录向上查找最近的 tags，边界为所属工作区根目录。
- 支持多根工作区、本地桌面、Remote SSH、WSL 和 Dev Container。
- 对已排序的 tags 使用 32 KiB 块和字节偏移二分查询，不把整个文件加载到内存。
- 支持数字地址、搜索地址、`line`、`kind` 和常见 scope 扩展字段。
- 识别 `.`、`::`、`->`、`#`、`/`、`\` 限定上下文并稳定排序候选。
- 找不到 tags、符号或候选时静默返回，不阻断其他语言扩展。

## 准备 tags

扩展要求经典格式、按区分大小写的符号名排序。推荐同时生成行号：

```bash
ctags --sort=yes --fields=+n -R .
```

支持 `!_TAG_FILE_SORTED=1`。未声明排序状态时会按已排序处理并写入诊断输出；值为 `0` 或 `2` 时会拒绝查询，不进行全文件线性回退。

## 配置

```json
{
  "ctagsNavigator.enabled": true,
  "ctagsNavigator.tagFileNames": ["tags", ".tags"],
  "ctagsNavigator.maxResults": 50
}
```

`tagFileNames` 只接受文件名，不接受绝对路径、目录分隔符或 `..`。`maxResults` 有效范围为 1–200；无效配置会使用安全默认值。

## 命令

- `Ctags Navigator: 跳转到当前符号定义`：单个定义直接跳转，多个定义按“相对路径:行号”和目标行内容显示列表供选择，未找到定义时显示提示；编辑器聚焦时默认快捷键为 Ctrl+Alt+Y。
- `Ctags Navigator: 清理缓存`：清理定位、查询和地址缓存，并关闭 tags 文件句柄。
- `Ctags Navigator: 诊断当前符号`：按需打开输出通道，显示符号、限定上下文、tags、排序状态、候选数量和耗时。

## 资源与安全边界

- 空闲时无磁盘活动、定时器、监听器和子进程。
- 最多打开 4 个 tags 文件句柄；自有查询与地址缓存总计不超过 4 MiB。
- 搜索地址只执行还原转义后的精确行匹配，不作为 JavaScript 正则执行；无行号时最多流式扫描目标文件前 32 MiB。
- 扩展只读取文件，不执行项目代码，支持不受信任工作区。

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

自动生成或更新 tags、外部命令、JSON tags、LSP/AST/Tree-sitter、引用、重命名、补全、诊断、语言特定规则及 Web 版 VS Code。
