<p align="left">
  简体中文 | <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img src="assets/icon.png" width="168" alt="Baidu Netdisk Knowledge MCP icon" />
</p>

<h1 align="center">Baidu Netdisk Knowledge MCP</h1>

<p align="center">
  <strong>百度网盘知识库 MCP</strong><br />
  让 AI 读懂你的百度网盘资料，帮你总结、提炼、分类和整理。
</p>

<p align="center">
  <img alt="MCP server" src="https://img.shields.io/badge/MCP-server-0A66FF" />
  <img alt="Baidu Netdisk" src="https://img.shields.io/badge/Baidu%20Netdisk-knowledge%20base-1677FF" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-32%20passing-brightgreen" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

很多人的百度网盘里都有一堆资料：PDF、课程讲义、收藏文章、项目文档、电子书、笔记、截图、压缩包。文件越存越多，真正要找、要读、要整理时反而很痛苦。

**Baidu Netdisk Knowledge MCP** 做的事很简单：把百度网盘接到支持 MCP 的 AI 客户端里，让 AI 可以安全地读取你选中的资料，生成摘要、知识点、待办、标签和整理建议。

它适合你，如果你想：

- 让 AI 帮你读百度网盘里的 PDF、文档、笔记和课程资料。
- 从一堆收藏资料里提炼知识点、问题和行动项。
- 把网盘资料整理成类似个人知识库的结构。
- 先看整理计划，再决定要不要移动文件。
- 给不同资料套不同处理规则，比如课程笔记、论文阅读、书籍总结。

## 它不是普通网盘工具

这个项目不是“上传下载 API 包装”，也不是一个新的网盘客户端。

它更像一个 **AI 资料助手接口**：

1. 你扫码授权百度网盘。
2. 你让 AI 搜索或浏览资料。
3. 你选择一个或多个文件。
4. AI 读取内容，生成笔记、摘要、分类建议。
5. 如果要整理文件，先给 dry-run 计划，不会直接乱动。

## 一个典型场景

你可以这样对 AI 说：

> 帮我在百度网盘里找 MCP 相关资料，选最近几份文档，读一下内容，总结成知识笔记，并建议应该放到哪个文件夹。

AI 会通过这个 MCP：

- 搜索百度网盘文件。
- 返回带编号的文件列表。
- 根据你的选择生成 `selectionId`。
- 下载并解析选中文件。
- 输出结构化笔记和整理建议。

输出可以包含：

```json
{
  "title": "MCP 入门资料整理",
  "category": "AI",
  "tags": ["MCP", "知识管理"],
  "summary": "这组资料主要介绍 MCP 的工具调用、上下文协议和客户端集成方式。",
  "keyPoints": ["MCP 可以让 AI 调用外部工具", "适合做个人资料库入口"],
  "questions": ["哪些客户端支持 MCP？"],
  "actionItems": ["整理常用 MCP server 清单"],
  "suggestedFolder": "/apps/知识库/AI/MCP"
}
```

## 核心功能

| 能力 | 说明 |
| --- | --- |
| 扫码登录 | 生成百度 OAuth 授权链接、终端二维码和 PNG 二维码 |
| 自由选择文件 | 支持搜索结果编号、路径、`fs_id`、递归目录和文件类型筛选 |
| 内容读取 | 支持 `.txt`、`.md`、`.json`、`.csv`、`.pdf`、`.docx` |
| 长文分块 | 长文件会切成 chunks，避免一次塞爆上下文 |
| 知识分析 | 摘要、关键点、问题、待办、标签、价值判断、建议目录 |
| 自定义 skill | 用 Markdown/YAML 写自己的资料处理模板 |
| 安全整理 | 只先生成 dry-run 计划，真实移动/删除需要你确认 |
| 审计日志 | 写操作会记录到本地 JSONL 日志 |

## 内置处理模板

项目内置 5 个 skill：

- `knowledge-notes`：把零散资料整理成结构化知识笔记。
- `course-notes`：整理课程资料、概念、作业和复习线索。
- `paper-reader`：阅读论文，提取问题、方法、结论和证据。
- `book-summary`：总结书籍、长文和阅读材料。
- `cleanup-organizer`：生成清理、归档和分类建议。

你也可以自己加 Markdown/YAML skill，不需要改代码。

## 安全原则

这个项目默认偏保守：

- 不会自动移动或删除你的网盘文件。
- 整理工具只生成 dry-run 计划。
- 删除文件必须显式传 `confirm: "DELETE"`。
- token 默认保存在用户主目录，不写进项目目录。
- 本地文件访问限制在 `BAIDU_LOCAL_ROOT` 下。
- 默认只允许在 `/apps/<appName>` 下做写操作。

## 适合谁

- 用百度网盘存学习资料、论文、电子书、项目文档的人。
- 想把网盘资料变成 AI 可读知识库的人。
- 想让 Codex、Claude Desktop、ChatGPT 等 MCP 客户端读取网盘资料的人。
- 想做个人知识管理，但不想手动一个个下载、打开、复制的人。

## 不适合谁

- 想要一个带界面的完整网盘 App。
- 只需要普通上传、下载、同步功能。
- 不想配置百度开放平台应用。
- 不使用支持 MCP 的 AI 客户端。

## 快速开始

先克隆仓库并安装依赖：

```bash
git clone https://github.com/capwitf/baidu-netdisk-knowledge-mcp.git
cd baidu-netdisk-knowledge-mcp
npm install
npm run build
```

准备百度开放平台配置：

```bash
BAIDU_APP_KEY=你的 AppKey
BAIDU_SECRET_KEY=你的 SecretKey
```

本地启动命令：

```bash
node dist/cli.js
```

## MCP 客户端配置

把路径换成你本机的仓库路径：

```json
{
  "mcpServers": {
    "baidu-netdisk-knowledge": {
      "command": "node",
      "args": ["C:/path/to/baidu-netdisk-knowledge-mcp/dist/cli.js"],
      "env": {
        "BAIDU_APP_KEY": "你的 AppKey",
        "BAIDU_SECRET_KEY": "你的 SecretKey",
        "BAIDU_REDIRECT_URI": "oob",
        "BAIDU_LOCAL_ROOT": "C:/path/to/baidu-netdisk-knowledge-mcp"
      }
    }
  }
}
```

## 首次授权

1. 打开 [百度网盘开放平台](https://pan.baidu.com/union/home)，创建应用。
2. 记录应用的 `AppKey` 和 `SecretKey`。
3. 在 MCP 客户端里调用 `baidu_auth_qrcode`。
4. 扫码授权后，把回调得到的 `code` 传给 `baidu_auth_exchange_code`。
5. 后续 token 会自动保存和刷新。

## 常用工作流

搜索资料：

```json
{
  "tool": "baidu_search_selectable_files",
  "args": {
    "key": "MCP",
    "dir": "/apps/知识库",
    "recursion": true
  }
}
```

按编号选择文件：

```json
{
  "tool": "baidu_select_files",
  "args": {
    "resultId": "res_xxx",
    "select": "1,3,5-9"
  }
}
```

读取和分析：

```json
{ "tool": "baidu_read_selection", "args": { "selectionId": "sel_xxx" } }
{ "tool": "baidu_analyze_selection", "args": { "selectionId": "sel_xxx" } }
{ "tool": "baidu_run_skill", "args": { "selectionId": "sel_xxx", "skill": "knowledge-notes" } }
```

生成整理计划：

```json
{
  "tool": "baidu_plan_organize_selection",
  "args": {
    "selectionId": "sel_xxx",
    "targetRoot": "/apps/知识库"
  }
}
```

`baidu_plan_organize_selection` 只返回计划，不移动文件。默认 `BAIDU_STRICT_APP_PATHS=true` 时，`targetRoot` 必须位于 `/apps/<appName>` 下。

## 工具清单

<details>
<summary>授权工具</summary>

- `baidu_auth_status`
- `baidu_auth_url`
- `baidu_auth_qrcode_url`
- `baidu_auth_qrcode`
- `baidu_auth_exchange_code`
- `baidu_auth_refresh`

</details>

<details>
<summary>浏览与选择工具</summary>

- `baidu_quota`
- `baidu_list_files`
- `baidu_list_all_files`
- `baidu_search_files`
- `baidu_search_selectable_files`
- `baidu_list_selectable_files`
- `baidu_select_files`
- `baidu_file_metas`

</details>

<details>
<summary>知识库工具</summary>

- `baidu_read_selection`
- `baidu_analyze_selection`
- `baidu_list_skills`
- `baidu_run_skill`
- `baidu_plan_organize_selection`

</details>

<details>
<summary>文件操作工具</summary>

- `baidu_create_folder`
- `baidu_rename_file`
- `baidu_copy_file`
- `baidu_move_file`
- `baidu_delete_file`
- `baidu_upload_file`
- `baidu_download_file`
- `baidu_operation_log`

</details>

## 自定义 Skill

在 `BAIDU_SKILLS_DIR` 指向的目录里放 `.md`、`.markdown`、`.yaml` 或 `.yml` 文件即可。

Markdown 示例：

```markdown
---
name: my-research-note
description: Research note extractor
category: research
outputSchema: knowledge-note
---

Extract thesis, evidence, questions, and follow-up tasks.
```

然后用：

- `baidu_list_skills` 查看可用 skill
- `baidu_run_skill` 运行指定 skill

## 配置项

`.env.example` 里列出了常用配置：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `BAIDU_APP_KEY` | 百度开放平台 AppKey | 必填 |
| `BAIDU_SECRET_KEY` | 百度开放平台 SecretKey | 必填 |
| `BAIDU_REDIRECT_URI` | OAuth 回调地址 | `oob` |
| `BAIDU_SCOPE` | OAuth scope | `basic,netdisk` |
| `BAIDU_TOKEN_STORE` | token 文件 | `~/.baidu-netdisk-mcp/tokens.json` |
| `BAIDU_OPERATION_LOG` | 写操作审计日志 | `~/.baidu-netdisk-mcp/operations.jsonl` |
| `BAIDU_SELECTION_STORE` | selectionId 存储 | `~/.baidu-netdisk-mcp/selections.json` |
| `BAIDU_CACHE_ROOT` | 本地 cache | `~/.baidu-netdisk-mcp/cache` |
| `BAIDU_SKILLS_DIR` | 自定义 skill 目录 | `~/.baidu-netdisk-mcp/skills` |
| `BAIDU_LOCAL_ROOT` | 本地文件访问根目录 | 启动目录 |
| `BAIDU_STRICT_APP_PATHS` | 写操作限制到 `/apps/<appName>` | `true` |
| `BAIDU_UPLOAD_CHUNK_SIZE_BYTES` | 上传分片大小 | `4194304` |
| `BAIDU_TRANSFER_MAX_RETRIES` | 上传/下载重试次数 | `3` |

## 开发

```bash
npm run check
```

这个命令会先运行 TypeScript 编译，再运行 Vitest 测试。

## 相关关键词

`Baidu Netdisk MCP`、`百度网盘 MCP`、`百度网盘知识库`、`AI 知识库`、`MCP server`、`个人知识管理`、`AI 文件整理`、`Knowledge Base MCP`

## 参考资料

- [百度网盘授权介绍](https://pan.baidu.com/union/doc/ol0rsap9s)
- [获取文件列表](https://pan.baidu.com/union/doc/nksg0sat9)
- [查询文件信息](https://pan.baidu.com/union/doc/Fksg0sbcm)
- [下载](https://pan.baidu.com/union/doc/pkuo3snyp)
- [上传能力说明](https://pan.baidu.com/union/doc/3ksg0s9ye)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT
