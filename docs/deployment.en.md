# Deployment and ChatGPT connection

[中文](deployment.zh-CN.md) · [Home](../README.en.md)

The recommended path is **a container service + Cloudflare Tunnel + ChatGPT OAuth**. Northflank is the author's example container platform. Your own Docker host, Kubernetes cluster, or any platform that runs this Dockerfile also works.

## 1. Prepare accounts, a domain, and keys

- A CNB account with access to the repositories you want to operate.
- ChatGPT on the web with permission to add custom MCP servers. Availability depends on your account/workspace.
- A Cloudflare account and a domain managed by Cloudflare, such as `example.com`.
- A container environment with outbound access to CNB API/Git and Cloudflare Tunnel. Restricted networks must allow Cloudflare's port 7844 (TCP/UDP, depending on transport).

Create a personal access token (PAT) in your CNB account settings. Grant only the required repositories and operations. Start with read access and add the relevant write permissions when needed. Never reuse someone else's deployment keys.

Generate **two different** random values by running this twice:

```bash
openssl rand -hex 32
```

Without OpenSSL, use Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| Variable                  | Value                                                       | Where it belongs                            |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `CNB_TOKEN`               | Your CNB PAT                                                | MCP server only                             |
| `MCP_ACCESS_TOKENS`       | First random value                                          | MCP server; enter on the OAuth consent page |
| `MCP_OAUTH_CLIENT_ID`     | A name you choose, e.g. `chatgpt-personal`                  | Server and ChatGPT OAuth configuration      |
| `MCP_OAUTH_CLIENT_SECRET` | Second random value                                         | Server and ChatGPT OAuth configuration      |
| `MCP_OAUTH_REDIRECT_URIS` | Exact HTTPS callback URI shown by ChatGPT                   | Server only                                 |
| `MCP_PUBLIC_BASE_URL`     | Your origin, e.g. `https://mcp.example.com`, without `/mcp` | Server only                                 |
| `TUNNEL_TOKEN`            | Cloudflare connector token from step 4                      | cloudflared container only                  |

This OAuth flow grants access to the **single CNB account configured on this server**. It is not CNB OAuth login. Never enter your CNB password or PAT on the consent page.

## 2. Choose source

Prefer GitHub outside mainland China and the CNB source mirror in mainland China:

```bash
git clone https://github.com/htazq/cnb-remote-mcp.git
# Alternative: git clone https://cnb.cool/htazq/cnb-remote-mcp.git
cd cnb-remote-mcp
```

The same version of the files is published in both places, with separate commit histories. No prebuilt CNB/GHCR image is assumed: the following steps build the root `Dockerfile`.

## 3A. Create a Northflank service

1. Create or select a Project. Fork the repository into your GitHub account and connect GitHub. If using CNB source, you can instead build locally, push to your own image registry, and create a Deployment service.
2. Choose **Create new → Service → Combined** for build and deployment. Select your repository and target branch or fixed version. Select **Dockerfile**, path `Dockerfile`, with the repository root as build context.
3. In **Runtime variables / Secret Group**, set `CNB_TOKEN`, `MCP_ACCESS_TOKENS`, `MCP_PUBLIC_BASE_URL`, and `MCP_WRITE_MODE=read-only`. Keep secrets in runtime variables, not build arguments.
4. Add HTTP port `3000` in **Networking** and keep it **Private**. Disable any public exposure created by automatic port detection. Copy the displayed internal DNS hostname: cloudflared will use `http://INTERNAL_DNS:3000` in step 4.
5. In Advanced → Health checks, configure CMD probes: `wget -qO- http://127.0.0.1:3000/healthz` for liveness and `wget -qO- http://127.0.0.1:3000/readyz` for readiness. In-container loopback checks avoid private-DNS Host allowlist issues.
6. Keep **one replica**. For example, start with 512 MiB RAM and adjust for repository size and concurrency. Deploy and confirm passing probes.
7. Consider disabling automatic CD for a personal instance so you can validate upgrades before deploying. Leave the three OAuth variables unset until you obtain the exact callback in step 5.

Northflank does not execute this repository's Compose files directly. Create the MCP service and the cloudflared service from step 4 separately. See [Northflank's build/deploy guide](https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code).

## 3B. Use your own Docker / Compose host

Skip this section if using 3A. In the cloned repository:

```bash
cp .env.example .env
# Edit .env: CNB_TOKEN, MCP_ACCESS_TOKENS, MCP_PUBLIC_BASE_URL
docker compose up -d --build
curl http://127.0.0.1:3000/healthz
```

In PowerShell, copy with `Copy-Item .env.example .env`. On Linux/macOS, use `chmod 600 .env` to restrict access. Git and Docker ignore `.env`, but you must still protect it. External traffic enters through Tunnel; Compose binds port 3000 only to host loopback.

The check should return `status: ok`. Other container platforms use the same Dockerfile, variables, and port. Both containers must be able to communicate over a private network.

## 4. Create Cloudflare Tunnel

Follow the [Cloudflare setup guide](https://developers.cloudflare.com/tunnel/get-started/): **Networking → Tunnels** (some dashboards use Zero Trust → Networks → Connectors). Create a cloudflared tunnel, select Docker, and copy the connector token from the installation command. Store only the token in the variable, not the entire command. Never post it in issues or chats.

### Northflank

1. Create another Deployment service in the MCP service's **same Project/private network** using `cloudflare/cloudflared:latest`.
2. Set runtime variable `TUNNEL_TOKEN`. Keep the image's entrypoint and override Command (CMD) with the argument array `['tunnel', '--no-autoupdate', 'run']`, i.e. `tunnel --no-autoupdate run`. If the UI also requires an explicit entrypoint, use `cloudflared`. Do not depend on shell expansion of `$TUNNEL_TOKEN`.
3. Expose no inbound ports. Deploy and confirm the connector is **Healthy** in Cloudflare. For production, pin a tested cloudflared version or digest after validation.

### Docker Compose

Set `TUNNEL_TOKEN` in `.env`, then run:

```bash
docker compose -f compose.yaml -f compose.cloudflare.yaml up -d --build
```

### Add the published application route

In the tunnel's Routes / Published application settings:

| Field                                  | Northflank                          | Docker Compose               |
| -------------------------------------- | ----------------------------------- | ---------------------------- |
| Public hostname                        | `mcp.example.com`                   | `mcp.example.com`            |
| Service type                           | HTTP                                | HTTP                         |
| Service URL                            | `http://YOUR_MCP_INTERNAL_DNS:3000` | `http://cnb-remote-mcp:3000` |
| Additional settings → HTTP Host Header | `mcp.example.com`                   | `mcp.example.com`            |

Replace the example domain with yours. Route the **whole hostname**, not only `/mcp`: OAuth also needs `/.well-known/*`, `/authorize`, `/oauth/approve`, `/token`, and `/revoke`. Do not cache these paths or put an interactive Cloudflare Access login/browser challenge in front of them. The application enforces OAuth/Bearer authentication itself.

Verify that `https://mcp.example.com/healthz` returns `status: ok`, and an unauthenticated POST to `/mcp` returns `401`. Opening `/mcp` in a browser returns `405`, which is expected for a Streamable HTTP POST server.

## 5. Configure OAuth and connect ChatGPT

1. In ChatGPT web, open **Plugins → + → Add custom MCP server**. Some accounts still show Settings → Apps / Connectors / Developer mode. Your account/workspace must permit custom MCP connections.
2. Use name `CNB`, Server URL `https://mcp.example.com/mcp`, and **OAuth** authentication. Enter your `MCP_OAUTH_CLIENT_ID` and `MCP_OAUTH_CLIENT_SECRET`. This server uses a preconfigured client; it does not require DCR/CIMD registration.
3. Copy the **complete callback URL** displayed in the creation/management page. Callback modes vary: do not guess a URI from an example. Connection tests may fail before OAuth is enabled; do not work around this by choosing No authentication.
4. Set that URL as server variable `MCP_OAUTH_REDIRECT_URIS` together with `MCP_OAUTH_CLIENT_ID` and `MCP_OAUTH_CLIENT_SECRET`. Confirm that `MCP_PUBLIC_BASE_URL` is the same HTTPS origin and that `MCP_ACCESS_TOKENS` includes a key of at least 32 characters. Save and restart the MCP container.
5. Retry the ChatGPT connection, review it, create the plugin, install it, and connect. If the creation flow has not shown the callback yet, save the connection first, then copy it from management and complete step 4; follow the current official UI.
6. On your server's bilingual consent page, check the domain, read/write mode, and callback. Enter a key from `MCP_ACCESS_TOKENS` and authorize. **Do not enter your CNB PAT**.
7. Back in chat, type `@`, select your installed CNB plugin, and ask: `First call whoami to verify my identity, then list my repositories.`

Official references: [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), [OAuth requirements](https://developers.openai.com/plugins/build/auth). UI and permissions can change. This repository ships no shared personal server endpoint: deploy your own instance.

## 6. Validate and enable writes

Confirm that `whoami` returns your CNB identity, then inspect your repository and latest build. A successful health check only proves that the service is running; it does not validate the CNB token.

For writes, grant the PAT the required operations, set `MCP_WRITE_MODE=write`, and restart. Refresh tools and reconnect in ChatGPT's plugin settings. Start by creating an issue or feature branch in a test repository. Review diffs before committing. PR merges, branch deletion, and default-branch pushes require `confirm: true`.

Example prompts:

- “Find the latest failed build in owner/repo, identify the failing stage, and read its relevant logs.”
- “Create a fix branch in owner/repo, change these two files, show the diff, then open a pull request.”
- “Dispatch the NPC task configured by this repository, and check its status until it finishes.”

## 7. Upgrades and troubleshooting

- **Reconnect after restart:** OAuth tokens are in memory. Run one replica and reconnect ChatGPT after restarts/upgrades. This is not persistent login or multi-tenancy.
- **CNB 401/403:** check PAT expiry, repository scope, and operation permissions in server-side `CNB_TOKEN`.
- **MCP 401 / OAuth failure:** check all three OAuth variables, exact callback, and HTTPS origin; for Bearer clients, use `MCP_ACCESS_TOKENS`.
- **403 forbidden host:** check Cloudflare's HTTP Host Header and the Northflank probe Host.
- **502 / unhealthy Tunnel:** check connector token, private service DNS, port 3000, and outbound connectivity. `localhost` inside cloudflared refers to that container, not the MCP container.
- **406:** MCP requests need `Accept: application/json, text/event-stream`.
- **Build failure:** use Node >= 22.12, the repository root as Docker context, and reachable npm/base-image registries.

For Compose upgrades, check out a verified version and run `docker compose -f compose.yaml -f compose.cloudflare.yaml up -d --build`. Roll back by checking out the earlier version and rebuilding. On Northflank, redeploy a previously verified build. Repeat the read-only checks after upgrading.

Audit goes to stdout and `${MCP_DATA_DIR}/audit.log` with local rotation. No persistent volume is mounted by default; configure platform log retention if required. Logs can include operation data: redact before sharing. See [Security](../SECURITY.md) for vulnerability reporting.
