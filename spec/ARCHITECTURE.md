# 架构

## 数据路径

```
MCP 客户端（ChatGPT / Claude / Cursor / IDE）
   │  HTTPS → Cloudflare Tunnel → 私有容器服务
   ▼
cnb-remote-mcp（本项目）
   │  层 1：校验 MCP Bearer 密钥或所有者 OAuth 令牌 → 身份 + 审计主体
   │  层 2：解析 CNB 凭证（共享 PAT）
   ▼
CNB OpenAPI（api.cnb.cool）/ Git HTTPS（cnb.cool）
   ▼
CNB.cool 平台
```

## 决策记录

### D1 —— 全新实现，而非 Fork 官方 MCP Server

- `cnb/cnb-mcp-server`（v0.6.7，已归档）：仓库**无 LICENSE 文件**
  （package.json 写了 MIT，但仓库里没有许可证文本与版权声明），按本仓库
  的许可政策不得复制其代码。且缺少 git 写操作、NPC 调度与认证管理层。
- `cnb/cnb-skill`（MIT）：CLI + 技能集合，不是 MCP Server；包装 CLI 会
  引入重量级依赖和 Shell 执行面（本仓库禁止）。
- 结论：编写原创的 MIT 代码库，只复用**公开契约**——官方 OpenAPI
  （swagger.json）的端点形状、`api_trigger_npc` 规范、OAuth 端点、
  `Authorization: Bearer` / `Accept: application/vnd.cnb.api+json` 约定。
  未复制任何官方项目源码。

### D2 —— 无状态 Streamable HTTP

每个 `POST /mcp` 请求都构建一个绑定该请求身份的全新 `McpServer` +
transport。MCP 传输不持有会话；可选 OAuth 授权另存内存，因此启用 OAuth 时使用一个副本，重启后客户端重新连接。
JSON 响应模式（不用 SSE 流）最大化客户端兼容性。

### D3 —— 两层认证

| 模式             | 层 1（客户端 → 服务器）                    | 层 2（服务器 → CNB） |
| ---------------- | ------------------------------------------ | -------------------- |
| 共享 PAT（默认） | `MCP_ACCESS_TOKENS` 密钥列表，常数时间比较 | `CNB_TOKEN` PAT      |

可选所有者 OAuth 是 MCP 下游认证门面，仍使用同一服务端 CNB PAT，不是 CNB 按用户 OAuth 登录。预配置客户端、显式浏览器同意、PKCE 和短期令牌用于适配 ChatGPT 网页；详见 [认证说明](../docs/authentication.md)。所有令牌摘要仅存内存；运行一个副本，重启后需重新连接。审计会写 stdout 和容器本地文件，因此不应称整个服务为“零落盘”。

### D4 —— 隔离 Git 工作区实现写能力

`code_push_files` 克隆仓库（`--filter=blob:none`）到
`<data>/git-workspaces/<hash>-<uuid>`，应用文件增删改、提交、推送
（`--atomic`，给了 `expect_head` 时用 `--force-with-lease`），然后删除
工作区。加固措施：

- argv 数组直接 spawn（无 shell）、`GIT_TERMINAL_PROMPT=0`
- 凭证经 `GIT_CONFIG_KEY_0=http.extraheader` 环境变量注入
  （不进 argv、不进 `.git/config`、不进远程 URL）
- 引用/路径/slug 校验、单次调用文件数与大小预算、硬超时
- 推送到默认分支需要 `confirm: true`

### D5 —— NPC 语义诚实化

`npc_dispatch` 发送官方 `api_trigger_npc` 事件并返回 `{sn, buildLogUrl}`。
工具文案明确"已受理 ≠ 已完成"，并引导用 `npc_status` 查询真实流水线状态
（`BuildStatusResult.status` 与各阶段状态）。

### D6 —— 输出有界

构建日志与文件读取在服务端截断（默认 60k/200k 字符），超大日志不会撑爆
客户端上下文；JSON 工具结果上限 60k 字符。这也限制了间接提示注入的
载荷大小，但主要防线仍是"远程内容只是数据"。

## 模块地图

```
src/
  config.ts        环境变量解析、启动安全断言（fail closed）
  version.ts       版本唯一来源
  server.ts        按身份组装 McpServer、工具注册
  http.ts          Express 应用：/mcp、/healthz、/readyz
  index.ts         STDIO 入口
  auth/            类型 + PAT 校验器 + 所有者 OAuth（层 1）
  cnb/             CNB OpenAPI 客户端（超时、错误映射）
  git/             工作区隔离 + git 操作
  security/        输入守卫（slug/ref/path/SN）、审计
  tools/           define.ts 框架 + 领域工具模块 + 注册表
```

## 备选方案对比

| 方案                       | 结论                                         |
| -------------------------- | -------------------------------------------- |
| Fork 官方 MCP Server       | 否决：LICENSE 文件缺失；技术栈已归档         |
| 把 cnb-cli 包装成 MCP 工具 | 否决：Shell 执行面、依赖重、版本漂移         |
| 自动暴露全部 Swagger 端点  | 否决：不安全的默认，工具体验差；改为精选集合 |
| 有状态会话 + SSE           | 暂缓：增加劫持面；JSON 模式覆盖现有客户端    |
