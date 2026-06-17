<p align="center">
  <img src="assets/icon.png" width="160" alt="Baidu Netdisk Knowledge MCP icon" />
</p>

<h1 align="center">Baidu Netdisk Knowledge MCP</h1>

<p align="center">
  <strong>百度网盘知识库 MCP</strong><br />
  把百度网盘变成 AI 可读取、可分析、可整理的个人知识库。
</p>

<p align="center">
  <img alt="MCP server" src="https://img.shields.io/badge/MCP-server-0A66FF" />
  <img alt="Baidu Netdisk" src="https://img.shields.io/badge/Baidu%20Netdisk-knowledge%20base-1677FF" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-32%20passing-brightgreen" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
</p>

一个基于 TypeScript 的百度网盘 MCP server。它不是前端网盘客户端，而是给 Codex、Claude Desktop、ChatGPT 等 MCP 客户端使用的工具层：扫码授权后，AI 可以浏览和选择你的百度网盘文件，读取资料内容，运行知识整理 skill，并先生成安全的 dry-run 整理计划。

搜索关键词：`Baidu Netdisk MCP`、`百度网盘 MCP`、`百度网盘知识库`、`Knowledge Base MCP`、`AI 文件整理`。

包名/CLI 名：`baidu-netdisk-knowledge-mcp`。兼容旧命令：`baidu-netdisk-mcp`。

## 它能做什么

- **扫码授权**：生成百度 OAuth 授权链接、终端二维码和 PNG data URL。
- **自由选文件**：支持目录浏览、递归列表、搜索结果编号选择、远程路径选择和 `fs_id` 选择。
- **复用 selectionId**：用 `1,3,5-9` 这类表达式把多个文件保存成一个可复用选择集。
- **读取资料内容**：下载选中文件到本地 cache，解析 `.txt`、`.md`、`.json`、`.csv`、`.pdf`、`.docx`。
- **知识库分析**：输出摘要、关键点、问题、待办、标签、建议分类路径和文件价值判断。
- **自定义 skill**：在 `skills/` 里增加 Markdown/YAML 模板，不用改代码。
- **安全整理**：整理计划默认 dry-run；真实移动、复制、删除受路径限制和审计日志保护。

## 当前边界

- 没有独立前端页面。交互入口是 MCP 客户端。
- 不会自动乱移动或删除网盘文件。整理工具只生成计划，执行移动需要你再明确调用对应文件操作工具。
- 真实百度账号端到端调用需要你自己配置百度开放平台应用和授权。

## 快速开始

```bash
npm install
npm run build
```

至少需要准备两个环境变量：

```bash
BAIDU_APP_KEY=你的 AppKey
BAIDU_SECRET_KEY=你的 SecretKey
```

本地 stdio 启动：

```bash
node dist/cli.js
```

## MCP 客户端配置

把路径换成你的实际项目路径：

```json
{
  "mcpServers": {
    "baidu-netdisk-knowledge": {
      "command": "node",
      "args": ["C:/Users/T/Desktop/workspace/baidu/dist/cli.js"],
      "env": {
        "BAIDU_APP_KEY": "你的 AppKey",
        "BAIDU_SECRET_KEY": "你的 SecretKey",
        "BAIDU_REDIRECT_URI": "oob",
        "BAIDU_LOCAL_ROOT": "C:/Users/T/Desktop/workspace/baidu"
      }
    }
  }
}
```

## 首次授权流程

1. 打开 [百度网盘开放平台](https://pan.baidu.com/union/home)，创建应用并记录 `AppKey` / `SecretKey`。
2. 在 MCP 客户端里调用 `baidu_auth_qrcode`。
3. 扫码授权后，把回调得到的 `code` 传给 `baidu_auth_exchange_code`。
4. token 会保存到本地 token store，后续需要时自动刷新。

## 常用工作流

搜索资料并生成编号列表：

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

按编号创建选择集：

```json
{
  "tool": "baidu_select_files",
  "args": {
    "resultId": "res_xxx",
    "select": "1,3,5-9"
  }
}
```

按远程路径或 `fs_id` 创建选择集：

```json
{
  "tool": "baidu_select_files",
  "args": {
    "paths": ["/apps/知识库/AI/mcp.md"],
    "fsids": ["9007199254740993"]
  }
}
```

读取、分析、运行 skill：

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

`baidu_plan_organize_selection` 只返回 dry-run 计划，不移动文件。默认 `BAIDU_STRICT_APP_PATHS=true` 时，`targetRoot` 必须位于 `/apps/<appName>` 下。

## 工具清单

授权：

- `baidu_auth_status`
- `baidu_auth_url`
- `baidu_auth_qrcode_url`
- `baidu_auth_qrcode`
- `baidu_auth_exchange_code`
- `baidu_auth_refresh`

浏览与选择：

- `baidu_quota`
- `baidu_list_files`
- `baidu_list_all_files`
- `baidu_search_files`
- `baidu_search_selectable_files`
- `baidu_list_selectable_files`
- `baidu_select_files`
- `baidu_file_metas`

知识库：

- `baidu_read_selection`
- `baidu_analyze_selection`
- `baidu_list_skills`
- `baidu_run_skill`
- `baidu_plan_organize_selection`

文件操作：

- `baidu_create_folder`
- `baidu_rename_file`
- `baidu_copy_file`
- `baidu_move_file`
- `baidu_delete_file`
- `baidu_upload_file`
- `baidu_download_file`
- `baidu_operation_log`

## 内置 Skills

项目内置 5 个 skill：

- `knowledge-notes`：零散知识整理成结构化笔记。
- `course-notes`：课程资料提取概念、练习和复习线索。
- `paper-reader`：论文阅读，提取问题、方法、结论和证据。
- `book-summary`：书籍/长文总结。
- `cleanup-organizer`：清理和归档建议。

自定义 skill 可以放到 `BAIDU_SKILLS_DIR` 指向的目录，支持 `.md`、`.markdown`、`.yaml`、`.yml`。

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

用 `baidu_list_skills` 查看可用 skill，用 `baidu_run_skill` 运行。

## 配置项

`.env.example` 包含常用配置：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `BAIDU_APP_KEY` | 百度开放平台 AppKey | 无，必填 |
| `BAIDU_SECRET_KEY` | 百度开放平台 SecretKey | 无，必填 |
| `BAIDU_REDIRECT_URI` | OAuth 回调地址 | `oob` |
| `BAIDU_SCOPE` | OAuth scope | `basic,netdisk` |
| `BAIDU_TOKEN_STORE` | token 文件 | `~/.baidu-netdisk-mcp/tokens.json` |
| `BAIDU_OPERATION_LOG` | 写操作审计日志 | `~/.baidu-netdisk-mcp/operations.jsonl` |
| `BAIDU_SELECTION_STORE` | selectionId 存储 | `~/.baidu-netdisk-mcp/selections.json` |
| `BAIDU_CACHE_ROOT` | 读取资料时的本地 cache | `~/.baidu-netdisk-mcp/cache` |
| `BAIDU_SKILLS_DIR` | 自定义 skill 目录 | `~/.baidu-netdisk-mcp/skills` |
| `BAIDU_LOCAL_ROOT` | 本地上传/下载允许访问的根目录 | 启动目录 |
| `BAIDU_STRICT_APP_PATHS` | 写操作限制到 `/apps/<appName>` | `true` |
| `BAIDU_UPLOAD_CHUNK_SIZE_BYTES` | 上传分片大小 | `4194304` |
| `BAIDU_TRANSFER_MAX_RETRIES` | 上传/下载重试次数 | `3` |

## 安全设计

- token 默认写入用户主目录，不写入项目目录。
- 读取资料会先下载到 cache，不修改原始网盘文件。
- 写操作支持 `dryRun`，建议先看计划再执行。
- `baidu_plan_organize_selection` 永远只生成计划。
- `baidu_delete_file` 必须传 `confirm: "DELETE"`。
- 创建文件夹、重命名、复制、移动、删除会写入 JSONL 审计日志。

## 开发

```bash
npm run check
```

这个命令会先运行 TypeScript 编译，再运行 Vitest 测试。

## 参考资料

- [百度网盘授权介绍](https://pan.baidu.com/union/doc/ol0rsap9s)
- [获取文件列表](https://pan.baidu.com/union/doc/nksg0sat9)
- [查询文件信息](https://pan.baidu.com/union/doc/Fksg0sbcm)
- [下载](https://pan.baidu.com/union/doc/pkuo3snyp)
- [上传能力说明](https://pan.baidu.com/union/doc/3ksg0s9ye)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT
