# 部署与 ChatGPT 接入

[English](deployment.en.md) · [返回首页](../README.md)

推荐路径是 **容器服务 + Cloudflare Tunnel + ChatGPT OAuth**。Northflank 是作者采用的容器平台示例；自有服务器、Docker、Kubernetes 或其他能运行本仓库 Dockerfile 的平台都可以。

## 1. 准备账号、域名与密钥

- CNB 账号，以及你希望操作的仓库权限。
- 可添加自定义 MCP 服务器的 ChatGPT 网页账号/工作区；入口和权限以你的界面为准。
- Cloudflare 账号和一个已托管在 Cloudflare 的域名，例如 `example.com`。
- 一个容器运行环境，可出站访问 CNB API/Git 和 Cloudflare Tunnel；受限网络需允许 Cloudflare 的 7844 端口（TCP/UDP，按所用传输）。

在 CNB 账号设置中创建个人访问令牌（PAT），仅选择所需仓库和操作权限。先从只读开始，需要提交代码、管理 Issue 等功能时再授予相应写权限。不要从别人的部署复制密钥。

生成**两个不同**的随机值，每次运行一次：

```bash
openssl rand -hex 32
```

没有 OpenSSL 时可使用 Node.js：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| 变量                      | 填写内容                                               | 放在哪里                         |
| ------------------------- | ------------------------------------------------------ | -------------------------------- |
| `CNB_TOKEN`               | CNB PAT                                                | 仅 MCP 服务端                    |
| `MCP_ACCESS_TOKENS`       | 第一个随机值                                           | MCP 服务端；OAuth 网页授权时输入 |
| `MCP_OAUTH_CLIENT_ID`     | 你起的客户端名称，例如 `chatgpt-personal`              | MCP 服务端和 ChatGPT OAuth 配置  |
| `MCP_OAUTH_CLIENT_SECRET` | 第二个随机值                                           | MCP 服务端和 ChatGPT OAuth 配置  |
| `MCP_OAUTH_REDIRECT_URIS` | ChatGPT 显示的精确 HTTPS 回调地址                      | 仅 MCP 服务端                    |
| `MCP_PUBLIC_BASE_URL`     | `https://mcp.example.com`，替换成你的域名，不加 `/mcp` | 仅 MCP 服务端                    |
| `TUNNEL_TOKEN`            | Cloudflare 隧道的连接器 token（第 4 步获取）           | 仅 cloudflared 容器              |

本项目的 OAuth 用于授权访问**本服务器配置的单个 CNB 账号**，不是 CNB OAuth 登录。不要在 OAuth 网页输入 CNB 密码或 CNB PAT。

## 2. 选择源码

中国大陆优先使用 CNB 源码镜像，其他地区优先 GitHub：

```bash
git clone https://cnb.cool/htazq/cnb-remote-mcp.git
# 或：git clone https://github.com/htazq/cnb-remote-mcp.git
cd cnb-remote-mcp
```

两处发布相同版本的文件，Git 提交历史独立。这里不假定存在可直接拉取的 CNB/GHCR 预构建镜像；下面从根目录的 `Dockerfile` 构建。

## 3A. 在 Northflank 创建服务

1. 在 Northflank 新建或选定一个 Project。把仓库 Fork 到你自己的 GitHub 账号并连接 GitHub；如使用 CNB 源码，也可先在本地构建并推到你自己的容器制品库，再创建 Deployment 服务。
2. 从 **Create new → Service → Combined** 创建构建和部署一体的服务，选择你的仓库及固定版本或目标分支。构建方式选 **Dockerfile**，文件位置 `Dockerfile`，构建上下文为仓库根目录。
3. 在 **Runtime variables / Secret Group** 设置 `CNB_TOKEN`、`MCP_ACCESS_TOKENS`、`MCP_PUBLIC_BASE_URL`，设置 `MCP_WRITE_MODE=read-only`。密钥使用运行时变量，不使用构建参数。
4. 在 **Networking** 添加 HTTP 端口 `3000`，保留为 **Private**，关闭自动识别端口可能启用的公网暴露。复制该服务显示的内部 DNS 主机名；第 4 步 cloudflared 将使用 `http://内部DNS:3000`。
5. 在 Advanced → Health checks 中配置 CMD 探针：存活用 `wget -qO- http://127.0.0.1:3000/healthz`，就绪用 `wget -qO- http://127.0.0.1:3000/readyz`。容器内检查不会受到私有 DNS 的 Host 白名单影响。
6. 保持**一个副本**。例如可从 512 MiB 内存起步，实际需求取决于 Git 仓库大小和并发。启动并确认健康检查通过。
7. 个人部署可关闭自动 CD，先验证新版本，再手动部署。暂不填写 OAuth 的三项变量，等待第 5 步获得精确回调地址。

Northflank 不会直接执行本仓库的 Compose 文件；请分别创建 MCP 服务和第 4 步的 cloudflared 服务。完整步骤参考 [Northflank 构建部署文档](https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code)。

## 3B. 使用自有 Docker / Compose

如果使用 3A，可跳过本节。在第 2 步克隆的目录中：

```bash
cp .env.example .env
# 编辑 .env：填写 CNB_TOKEN、MCP_ACCESS_TOKENS、MCP_PUBLIC_BASE_URL
docker compose up -d --build
curl http://127.0.0.1:3000/healthz
```

PowerShell 用 `Copy-Item .env.example .env` 复制文件；Linux/macOS 可以用 `chmod 600 .env` 限制访问。`.env` 已被 Git 和 Docker 构建上下文忽略，仍应妥善保管。对外只走 Tunnel，Compose 的 3000 端口仅绑定本机回环地址。

本地验证应返回 `status: ok`。其他容器平台使用同样的 Dockerfile、环境变量和端口配置；两个容器必须能通过私有网络互通。

## 4. 创建 Cloudflare Tunnel

按 [Cloudflare 官方步骤](https://developers.cloudflare.com/tunnel/get-started/) 在控制台 **Networking → Tunnels** 创建 tunnel（部分界面位于 Zero Trust → Networks → Connectors）。选择 cloudflared / Docker，复制安装命令中的连接器 token。不要复制整条命令到环境变量，也不要把 token 发到 Issue 或聊天中。

### Northflank

1. 在 MCP 服务的**同一 Project/私有网络**中新建 Deployment 服务，镜像为 `cloudflare/cloudflared:latest`。
2. Runtime variable 设置 `TUNNEL_TOKEN`。保留镜像自带的入口程序，将 Command（CMD）覆写为参数数组 `['tunnel', '--no-autoupdate', 'run']`，即 `tunnel --no-autoupdate run`。如界面同时要求完整 EntryPoint，填 `cloudflared`；不要用 shell `$TUNNEL_TOKEN` 展开命令。
3. 不开放任何入站端口。启动后确认 Cloudflare 控制台 connector 变为 **Healthy**。正式环境可在验证后固定 cloudflared 镜像版本或 digest。

### Docker Compose

把连接器 token 填入 `.env` 的 `TUNNEL_TOKEN`，运行：

```bash
docker compose -f compose.yaml -f compose.cloudflare.yaml up -d --build
```

### 添加公网应用路由

在 tunnel 的 Routes / Published application 中添加：

| 字段                                   | Northflank                   | Docker Compose               |
| -------------------------------------- | ---------------------------- | ---------------------------- |
| Public hostname                        | `mcp.example.com`            | `mcp.example.com`            |
| Service type                           | HTTP                         | HTTP                         |
| Service URL                            | `http://你的MCP内部DNS:3000` | `http://cnb-remote-mcp:3000` |
| Additional settings → HTTP Host Header | `mcp.example.com`            | `mcp.example.com`            |

域名替换成你的实际域名。路由整个主机名，**不要仅路由 `/mcp`**：OAuth 还要访问 `/.well-known/*`、`/authorize`、`/oauth/approve`、`/token`、`/revoke`。不要缓存这些路径，也不要为它们设置交互式 Cloudflare Access 登录或浏览器挑战；应用本身会强制 OAuth/Bearer 认证。

验证 `https://mcp.example.com/healthz` 返回 `status: ok`；不带认证 POST `/mcp` 应返回 `401`。直接在浏览器打开 `/mcp` 返回 `405` 是正常的，因为服务器使用 Streamable HTTP POST。

## 5. 配置 OAuth 并连接 ChatGPT

1. 在 ChatGPT 网页打开 **Plugins → + → Add custom MCP server**。部分界面仍位于 Settings → Apps / Connectors / Developer mode。账号/工作区需允许自定义 MCP。
2. 名称填写 `CNB`，Server URL 填 `https://mcp.example.com/mcp`，认证选 **OAuth**，填写第 1 步的 `MCP_OAUTH_CLIENT_ID` 和 `MCP_OAUTH_CLIENT_SECRET`。本服务器使用预配置客户端，不需要 DCR/CIMD 注册。
3. 从创建/管理页复制 ChatGPT 给出的**完整回调 URL**。回调模式可能随账号变化，不要凭示例猜测。尚未启用 OAuth 时连接测试可能失败；这是待完成配置，不要选择 No authentication 来绕过。
4. 将这个 URL 填入服务端 `MCP_OAUTH_REDIRECT_URIS`，同时填写 `MCP_OAUTH_CLIENT_ID` 和 `MCP_OAUTH_CLIENT_SECRET`。确认 `MCP_PUBLIC_BASE_URL` 是同一个 HTTPS 源站地址，`MCP_ACCESS_TOKENS` 至少有一个长度不小于 32 的密钥。保存并重启 MCP 容器。
5. 在 ChatGPT 重新测试/创建连接，Review 后选择 Create as a plugin，安装并连接。若创建流程尚未显示回调地址，可先保存连接，再从其管理页复制地址并完成步骤 4；入口位置以当前官方界面为准。
6. 浏览器打开本服务器的双语授权页后，核对域名、只读/写入模式和回调地址；输入 `MCP_ACCESS_TOKENS` 中的访问密钥，点击授权。**不要输入 CNB PAT**。
7. 回到聊天，输入 `@` 选择已安装的 CNB 插件，发送：`先调用 whoami 验证身份，再查询我的仓库列表。`

官方参考：[添加自定义 MCP 服务器](https://developers.openai.com/api/docs/guides/custom-mcp-server)、[OAuth 要求](https://developers.openai.com/plugins/build/auth)。界面和权限可能变化，以当前页面显示为准。本仓库不附带任何人的可共享服务器地址；每位使用者部署自己的实例。

## 6. 验证并开启写操作

先确认 `whoami` 是你的 CNB 身份，然后查询你自己的仓库和最新构建。不要把 `healthz` 成功当作 CNB 令牌已验证：健康检查只验证本服务存活。

需要写入时：为 CNB PAT 添加所需操作权限，设 `MCP_WRITE_MODE=write` 并重启，再在 ChatGPT 插件管理中刷新工具、重新连接。先在测试仓库创建一个 Issue / 功能分支；提交前检查差异。合并 PR、删分支、推默认分支需 `confirm: true`。

示例提问：

- “查看 owner/repo 最新一次失败构建，定位失败阶段并读取相关日志。”
- “在 owner/repo 创建一个修复分支，修改这两个文件，展示差异后提交 PR。”
- “调度仓库已配置的 NPC 任务，并继续查询状态直到结束。”

## 7. 升级与排障

- **重启后重新授权**：OAuth 令牌仅在内存中，运行一个副本；重启/升级后在 ChatGPT 重新连接。不是持久登录或多租户服务。
- **CNB 401/403**：检查 PAT 有效期、仓库范围和操作权限；检查的是服务端 `CNB_TOKEN`。
- **MCP 401 / 无法 OAuth**：检查三个 OAuth 变量、精确回调地址、HTTPS 源站地址，或检查 Bearer 客户端是否用了 `MCP_ACCESS_TOKENS`。
- **403 forbidden host**：Cloudflare HTTP Host Header、Northflank 探针 Host 必须符合前述设置。
- **502 / Tunnel 不健康**：检查连接器 token、私有服务 DNS、端口 3000，以及出站网络；不要用 cloudflared 容器内的 `localhost` 指代另一个容器。
- **406**：MCP 请求需携带 `Accept: application/json, text/event-stream`。
- **构建失败**：确认 Node >= 22.12，Dockerfile 上下文为仓库根目录，npm registry 和基础镜像源可达。

Compose 升级：检出已验证的版本，执行 `docker compose -f compose.yaml -f compose.cloudflare.yaml up -d --build`。回滚则检出之前版本并重建。Northflank 使用已验证的旧构建回滚。升级后重新执行第 6 步只读验证。

审计写 stdout 和 `${MCP_DATA_DIR}/audit.log`（本地轮转），默认不挂持久卷；需要长期审计时配置平台日志保留。日志可能包含操作数据，发布日志前脱敏。发现安全问题见 [安全说明](../SECURITY.md)。
