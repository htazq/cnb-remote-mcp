# CNB Remote MCP

[中文](README.md) · English · [MIT](LICENSE)

**Operate CNB.cool from ChatGPT on the web through your own MCP plugin.**

An unofficial, self-hosted remote MCP server for CNB: read repositories and code, manage issues and pull requests, inspect build logs, commit files, and dispatch CNB NPC tasks. Supports Streamable HTTP and STDIO. Every operation is limited by your CNB token's permissions.

## Choose a source mirror

| Region                       | Repository                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| Mainland China: prefer CNB   | [cnb.cool/htazq/cnb-remote-mcp](https://cnb.cool/htazq/cnb-remote-mcp)     |
| Other regions: prefer GitHub | [github.com/htazq/cnb-remote-mcp](https://github.com/htazq/cnb-remote-mcp) |

Both repositories publish the same version of the source, with separate platform-specific commit histories. These are **source mirrors**. The guide builds container images from source rather than relying on an unpublished registry image. Connectivity depends on your network; choosing a mirror does not change ChatGPT account or regional availability.

## Deployment to ChatGPT

```text
ChatGPT web / custom MCP plugin
        | HTTPS + OAuth
Cloudflare Tunnel
        | HTTP over your private container network
CNB Remote MCP (Northflank / your Docker host / another container platform)
        | Your CNB PAT
CNB OpenAPI / Git
```

**[Step-by-step guide (English)](docs/deployment.en.md) · [完整部署教程（中文）](docs/deployment.zh-CN.md)**

The guide covers creating a CNB token, choosing source, creating a Northflank service (or using your own container platform), configuring Cloudflare Tunnel, connecting ChatGPT, and validating read/write access. Northflank is an example, not a requirement. This project does not require an OpenAI API key.

## Local quick start

Install Docker Engine / Docker Desktop and Compose v2. Choose either source URL:

```bash
git clone https://github.com/htazq/cnb-remote-mcp.git
# Alternative: git clone https://cnb.cool/htazq/cnb-remote-mcp.git
cd cnb-remote-mcp
cp .env.example .env
```

Edit `.env`: set `CNB_TOKEN` and set `MCP_ACCESS_TOKENS` to a separate key generated with `openssl rand -hex 32`. Keep read-only mode for the first connection. In PowerShell, use `Copy-Item .env.example .env`.

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/healthz
```

After receiving `status: ok`, a local MCP client with custom-header support can connect using:

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

For ChatGPT web, follow the guide's **HTTPS + OAuth** flow. The local header configuration is not the ChatGPT connection flow.

## Capabilities and permissions

| Group                  | Capabilities                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| Account / repositories | Identity, repository search and creation, branches, tags, files, commits, diffs |
| Issues / pull requests | Query, create, update, comment, review, merge                                   |
| Builds                 | History, status, stage logs, trigger, cancel                                    |
| NPC                    | Search roles, dispatch tasks, inspect status and actions                        |
| Code                   | Commit and push file changes through isolated Git workspaces                    |

Read tools are exposed by default. Set `MCP_WRITE_MODE=write` to enable write tools. Merging a PR, deleting a branch, or pushing to the default branch also requires `confirm: true` in that tool call. Build/NPC acceptance is not completion: query status after dispatch. Use `tools/list` for the actual tool list; see the [capability matrix](spec/CAPABILITY_MATRIX.md) for details.

## Configuration and boundaries

| Setting                                           | Purpose                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `CNB_TOKEN`                                       | Server-side CNB PAT; keep it on the server                               |
| `MCP_ACCESS_TOKENS`                               | Client Bearer keys; also verify the owner on the OAuth consent page      |
| `MCP_PUBLIC_BASE_URL`                             | Public HTTPS origin, such as `https://mcp.example.com`                   |
| `MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET` | Preconfigured OAuth client for ChatGPT; leave blank to disable OAuth     |
| `MCP_OAUTH_REDIRECT_URIS`                         | Exact HTTPS callback URI from ChatGPT's management page; comma-separated |
| `MCP_WRITE_MODE`                                  | `read-only` by default; explicitly set `write` for mutations             |

See [.env.example](.env.example) for every variable. [compose.yaml](compose.yaml) runs locally; [compose.cloudflare.yaml](compose.cloudflare.yaml) adds Cloudflare Tunnel.

This is a **self-hosted gateway for one CNB account**. Authorized clients share that account's permissions; this is not a multi-tenant CNB login service. OAuth grants are held in memory: run one replica and reconnect ChatGPT after restarts. No database or persistent volume is required. Audit records go to stdout and a local rotating file; use platform log retention if needed. Logs may contain repository paths, file paths, and operation data such as commit content. Review them before sharing.

## Development and contributions

Node.js >= 22.12:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

- [Contributing / 贡献指南](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md) · [Security / 安全说明](SECURITY.md)
- [Architecture](spec/ARCHITECTURE.md) · [Agent instructions](AGENTS.md)

Released under [MIT](LICENSE). Not affiliated with or endorsed by CNB, OpenAI, Northflank, or Cloudflare. Their names and trademarks belong to their respective owners.
