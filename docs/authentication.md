# Authentication / 认证

[中文部署指南](deployment.zh-CN.md) · [English deployment guide](deployment.en.md)

## Two independent layers / 两层独立身份

1. Client → MCP: a key from `MCP_ACCESS_TOKENS`, or an access token issued by the optional owner OAuth facade.
2. MCP → CNB: the server's `CNB_TOKEN` PAT. Never use this as a client key or enter it in ChatGPT.

- 客户端 → MCP：`MCP_ACCESS_TOKENS` 中的密钥，或可选所有者 OAuth 签发的访问令牌。
- MCP → CNB：服务器的 `CNB_TOKEN` PAT，不得当作客户端密钥，也不要填进 ChatGPT。

## Owner OAuth / 所有者 OAuth

Enable all three `MCP_OAUTH_*` variables with an HTTPS `MCP_PUBLIC_BASE_URL`, a CNB PAT, and a 32+ character owner access key. The preconfigured client uses `client_secret_post`, exact HTTPS callback allowlists, authorization code + S256 PKCE, browser-bound consent, single-use 60-second codes, 1-hour access tokens, rotating 30-day refresh tokens, and grant-family revocation. Tokens are held by digest in memory. Restart invalidates all grants. Run one replica and reconnect after deployment. Multiple clients share the configured CNB account; this does not implement per-user CNB login.

启用时填写三项 `MCP_OAUTH_*`、HTTPS `MCP_PUBLIC_BASE_URL`、CNB PAT 以及至少 32 位的所有者访问密钥。预配置客户端使用 `client_secret_post`、精确 HTTPS 回调白名单、授权码与 S256 PKCE、浏览器绑定的显式同意、60 秒单次授权码、1 小时访问令牌、轮换的 30 天刷新令牌，以及整组授权撤销。令牌摘要仅存于内存，重启全部失效；运行一个副本并在部署后重新连接。所有客户端共享服务端 CNB 账号，不提供每人独立 CNB 登录。

## Rotation / 轮换

Replace a client key and restart to revoke its static access and all OAuth sessions. Replace the OAuth client secret on both server and ChatGPT, then reconnect. Rotate `CNB_TOKEN` only on the server. Keep the two credential layers separate. Cloudflare connector tokens belong only to cloudflared.

更换客户端密钥并重启，可撤销对应静态访问与全部 OAuth 会话。OAuth 客户端密钥需同时更新服务端与 ChatGPT 后重新连接；CNB PAT 仅在服务器轮换。Cloudflare 连接器 token 仅交给 cloudflared。
