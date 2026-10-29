# ChatGPT connection / ChatGPT 接入

The deployment guide uses Cloudflare Tunnel and the optional owner OAuth flow.
部署教程使用 Cloudflare Tunnel 与可选的服务器所有者 OAuth 授权：

- [中文：Cloudflare Tunnel 与 ChatGPT](deployment.zh-CN.md#4-创建-cloudflare-tunnel)
- [English: Cloudflare Tunnel and ChatGPT](deployment.en.md#4-create-cloudflare-tunnel)

Cloudflare Tunnel is distinct from OpenAI Secure MCP Tunnel. Do not use the old, illustrative `tunnel-client` commands. The server requires application authentication regardless of transport.

Cloudflare Tunnel 和 OpenAI Secure MCP Tunnel 是不同产品。请使用完整教程，不使用旧版示意性的 `tunnel-client` 命令。无论传输方式如何，应用认证始终必需。
