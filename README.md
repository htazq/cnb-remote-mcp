# CNB Remote MCP

中文 · [English](README.en.md) · [MIT](LICENSE)

**在 ChatGPT 网页中，通过自己的 MCP 插件操作 CNB.cool。**

一个非官方、自托管的 CNB 远程 MCP 服务器：查询仓库、阅读代码、管理 Issue / PR、检查构建日志、提交文件，以及调度 CNB NPC。支持 Streamable HTTP 和 STDIO；工具受你的 CNB 令牌权限约束。

## 选择源码镜像

| 地区                  | 仓库                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| 中国大陆，优先 CNB    | [cnb.cool/htazq/cnb-remote-mcp](https://cnb.cool/htazq/cnb-remote-mcp)     |
| 其他地区，优先 GitHub | [github.com/htazq/cnb-remote-mcp](https://github.com/htazq/cnb-remote-mcp) |

两处发布相同版本的源代码，提交历史按平台独立维护。这里的“镜像”指源码仓库；教程从源码构建 Docker 镜像，不依赖未发布的预构建镜像。网络可达性取决于你的环境；源码镜像选择不会改变 ChatGPT 的账号或地区可用性。

## 从部署到 ChatGPT

```text
ChatGPT 网页 / 自定义 MCP 插件
        │ HTTPS + OAuth
Cloudflare Tunnel
        │ 私有网络中的 HTTP
CNB Remote MCP（Northflank / 自有 Docker / 其他容器平台）
        │ 你的 CNB PAT
CNB OpenAPI / Git
```

**[完整部署教程（中文）](docs/deployment.zh-CN.md) · [Step-by-step guide (English)](docs/deployment.en.md)**

教程按顺序覆盖：创建 CNB 令牌 → 选择源码 → 新建 Northflank 容器服务（或使用自有平台）→ 配置 Cloudflare Tunnel → 连接 ChatGPT → 验证读写。Northflank 只是示例，不是必需依赖；不需要为本项目申请 OpenAI API key。

## 本地快速体验

需要 Docker Engine / Docker Desktop 和 Compose v2。在终端执行，任选一个源码地址：

```bash
git clone https://cnb.cool/htazq/cnb-remote-mcp.git
# 或：git clone https://github.com/htazq/cnb-remote-mcp.git
cd cnb-remote-mcp
cp .env.example .env
```

编辑 `.env`，填写 `CNB_TOKEN`，并将 `openssl rand -hex 32` 生成的独立密钥填入 `MCP_ACCESS_TOKENS`。保留默认只读模式。PowerShell 可以使用 `Copy-Item .env.example .env`。

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/healthz
```

返回 `status: ok` 后，本地支持自定义 Header 的 MCP 客户端可连接：

```json
{
  "mcpServers": {
    "cnb": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer REPLACE_WITH_YOUR_MCP_ACCESS_KEY" }
    }
  }
}
```

ChatGPT 网页使用教程中的 **HTTPS + OAuth** 流程；不要把本地 Header 配置直接照搬到 ChatGPT。

## 能力与权限

| 分组       | 能力                                                   |
| ---------- | ------------------------------------------------------ |
| 账号与仓库 | 当前账号、仓库搜索与创建、分支、标签、文件、提交、差异 |
| Issue / PR | 查询、创建、更新、评论、评审、合并                     |
| 构建       | 历史、实时状态、阶段日志、触发与取消                   |
| NPC        | 角色搜索、任务调度、状态与动作记录                     |
| 代码       | 在隔离 Git 工作区内提交与推送文件                      |

默认只暴露读工具；设置 `MCP_WRITE_MODE=write` 后启用写工具。合并 PR、删除分支、推送默认分支还需工具调用中的 `confirm: true`。构建/NPC 触发返回“已受理”后，需继续查询状态才能确认完成。实际工具列表来自 `tools/list`，完整范围见 [能力矩阵](spec/CAPABILITY_MATRIX.md)。

## 配置与边界

| 配置                                              | 用途                                                    |
| ------------------------------------------------- | ------------------------------------------------------- |
| `CNB_TOKEN`                                       | 服务端调用 CNB 的 PAT，仅放在服务器                     |
| `MCP_ACCESS_TOKENS`                               | 客户端 Bearer 密钥；OAuth 授权页用它验证服务器所有者    |
| `MCP_PUBLIC_BASE_URL`                             | 公网 HTTPS 源站地址，例如 `https://mcp.example.com`     |
| `MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET` | ChatGPT 预配置 OAuth 客户端；留空则关闭 OAuth           |
| `MCP_OAUTH_REDIRECT_URIS`                         | ChatGPT 管理页显示的精确 HTTPS 回调地址，多个用逗号分隔 |
| `MCP_WRITE_MODE`                                  | 默认 `read-only`；写操作需显式设为 `write`              |

所有变量见 [.env.example](.env.example)。[compose.yaml](compose.yaml) 用于本地部署；[compose.cloudflare.yaml](compose.cloudflare.yaml) 添加 Cloudflare Tunnel。

这是**单个 CNB 账号的自托管网关**，所有授权客户端共享该账号权限，不是多用户 CNB 登录服务。OAuth 授权信息仅保存在内存中，使用一个副本；重启后需在 ChatGPT 重新连接。无需数据库或持久卷；审计记录会写 stdout 和本地轮转文件，需长期保留时使用平台日志系统。日志可能包含仓库路径、文件路径与提交内容等操作数据，分享前请检查。

## 开发与贡献

Node.js >= 22.12：

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

- [贡献指南 / Contributing](CONTRIBUTING.md)
- [变更记录](CHANGELOG.md) · [安全说明 / Security](SECURITY.md)
- [架构](spec/ARCHITECTURE.md) · [Agent 约束](AGENTS.md)

本项目以 [MIT](LICENSE) 发布，与 CNB、OpenAI、Northflank、Cloudflare 无隶属或背书关系。各平台名称和商标归其所有者所有。
