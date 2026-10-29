# Scope and release acceptance / 范围与发布验收

## Scope / 范围

A self-hosted gateway maps a selected set of MCP tools to CNB OpenAPI and controlled Git operations. Each deployment uses its owner's CNB PAT. HTTP clients authenticate independently through Bearer keys or optional owner OAuth. STDIO uses the local process environment. This is not a SaaS, multi-tenant CNB login service, arbitrary API proxy, or shell executor.

自托管网关将精选 MCP 工具映射到 CNB OpenAPI 与受控 Git 操作，每个部署使用其所有者的 CNB PAT。HTTP 客户端通过独立 Bearer 密钥或可选所有者 OAuth 认证，STDIO 使用本地进程环境。不提供 SaaS、多租户 CNB 登录、任意 API 代理或 Shell 执行器。

## Release acceptance / 发布验收

- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass on a clean installation.
- Authentication tests cover unauthorized requests, exact redirects, PKCE, browser-bound consent, code replay, refresh rotation, revocation, and expiry.
- Docker builds with Git available; health checks respond; unauthenticated MCP calls fail; read-only `tools/list` hides mutations.
- Both Compose configurations parse using non-secret fixture values.
- Scan the release tree and source history for credentials; inspect public URLs and identities before publishing.
- Publish the same released file manifest to both source mirrors, with platform-specific commit authors and independent histories.
- Deployment instructions are available in Chinese and English. CI verifies protocol and container behavior with mocks. End-to-end ChatGPT and cloud-platform setup requires a real user account and is not implied by passing CI.

- 在干净安装环境中通过类型、代码、测试与构建检查。
- 认证测试覆盖未授权访问、精确回调、PKCE、浏览器绑定同意、授权码重放、刷新轮换、撤销与过期。
- 验证镜像包含 Git、健康检查、未认证拒绝和只读工具列表；用非敏感样例验证两种 Compose 配置。
- 发布前扫描文件和历史中的凭证，并检查公开 URL 与提交身份。
- 两边发布相同文件清单，但使用各自平台提交身份与独立历史。
- 中英教程同时维护；CI 通过不代表已完成真实账号的 ChatGPT / 云平台端到端接入。

Historical live CNB smoke evidence belongs to the corresponding changelog version; it is not proof of a later deployment's current state.

历史 CNB 实测证据属于对应版本的变更记录，不能作为后续部署当前状态的证明。
