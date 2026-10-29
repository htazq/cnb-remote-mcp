# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-29

### Added

- Optional single-owner OAuth facade for ChatGPT web: explicit browser-bound consent, exact redirect allowlists, S256 PKCE, short-lived codes/access tokens, rotating refresh tokens, and grant-family revocation. The upstream CNB PAT stays server-side. One replica; reconnect after restart.
- Bilingual deployment walkthrough for Northflank or any container platform, Cloudflare Tunnel, and ChatGPT, with local and tunnel Compose files.
- GitHub source mirror, independent platform commit identities, GitHub CI including Docker/Compose smoke checks, and bilingual security/contribution guidance.

### Fixed

- Docker runtime now includes Git and CA certificates for `code_push_files`.
- Empty optional public URL from `.env.example` no longer prevents startup.
- Compiled-entrypoint test invokes TypeScript through Node for Windows compatibility.
- Documentation no longer claims an unpublished CNB image exists or that audit data is never written to disk.
- Test dependencies updated to Vitest 4.1.12 to resolve npm audit findings.

### 中文

- 增加 ChatGPT 所需的可选单账号 OAuth，保留现有 Bearer 接入；OAuth 授权仅保存在内存中，重启后重新连接。
- 完善中英部署教程、Cloudflare Tunnel Compose、GitHub 镜像及平台提交身份说明。
- 修复容器缺少 Git、空公网地址配置、Windows 测试入口，更新开发依赖。

### Security

- 升级 `zod` 3.25.76 → 4.6.6（CVE-2023-54404，CVSS 7.5）：`$ZodArray`
  在元素校验失败时会无上限累积问题对象，未限制长度的数组模式可被用来
  撑爆内存。所有工具 schema 本就带 `.max()` 上限（`files` ≤ 100、
  `labels`/`assignees` ≤ 20），升级后底层解析器也不再累积无界问题集合。

### Fixed

- `tests/integration/entrypoint.test.ts` 自行 `npm run build` 后再启动
  `dist/http.js`，不再依赖调用方先构建。CI 只跑 `npm test`，此前 clean
  checkout 下必然因 `Cannot find module '/workspace/dist/http.js'` 失败。

### Changed

- 文档全面中文化：README 改为中文主文档（英文版 `README.en.md`）、`docs/`
  与 `spec/` 全部改为中文、`.env.example` 注释中文化；README 部署教程
  精简为四步。

## [0.2.0] - 2026-10-25

### Changed

- **完全无状态，仅共享 PAT 认证。** 移除自助注册体系（设备流登录页、
  PAT 注册端点、加密令牌存储及其数据卷需求）。所有配置走环境变量；
  审计同步输出到 stdout；全程无需数据卷。
  原因：CNB OAuth 应用无法自助注册，CLI 设备流令牌非永久
  （access ≈ 8 小时 / refresh ≈ 180 天）——共享 PAT 模型才是无状态
  自托管网关的诚实选择。

## [0.1.0] - 2026-10-25

### Added

- MCP server over Streamable HTTP (`/mcp`, stateless JSON) and STDIO transports.
- Two-layer authentication: MCP client bearer tokens (PAT mode) and per-user
  CNB OAuth 2.0 (authorization code, encrypted at-rest token store, refresh,
  revoke, self-service `/auth/*` endpoints).
- 44 tools across account / repo / issue / pr / build / npc / code domains,
  including:
  - repository, branch, tag, file, commit and diff queries;
  - issue and pull-request CRUD with comments, reviews, checks;
  - build history, status, stage logs, trigger and cancel;
  - NPC dispatch via the official `api_trigger_npc` event, status tracking
    and observability;
  - `code_push_files`: controlled commit & push through isolated git
    workspaces with `--force-with-lease` optimistic concurrency.
- Read-only by default; write tools require `MCP_WRITE_MODE=write`;
  destructive tools additionally require `confirm: true` per call.
- Append-only, redacting audit log; structured JSON logging with secret
  redaction.
- Health/readiness endpoints, Docker image, Compose deployment, CI pipeline.
- Test suite: 45 unit/integration/security tests (mock CNB API).

### Verified against the real CNB platform

- Read path: `whoami`, `repo_get`, `repo_branch_list`, `repo_file_read`,
  `repo_tree_list`, `build_list`, `build_status`, `build_stage_logs`,
  `pr_list`, `issue_list` — live PASS.
- Write path (this repository, sandbox branch): `code_push_files` →
  `pr_create` (#1) → `pr_checks` → `pr_merge` (squash, merged: true);
  `issue_create` (#2) → `issue_comment_add` → `issue_update` (closed) —
  live PASS.
- NPC: `npc_dispatch` returned real build SN `cnb-2tu-1k5nfdc3q`;
  `npc_status` reported the pipeline's real completion (`npc go` success).
- Docker image builds, container starts, `/healthz` passes inside the
  container; STDIO transport verified over a piped session.
- Fix found by real testing: git workspace operations now always run with
  the workspace as cwd (checkout/add/commit/push previously defaulted to the
  server process cwd).

### Security

- HTTP transport refuses to start without client authentication (fail closed).
- Path traversal, option injection and SSRF guards on all user-controlled
  inputs; git invoked without a shell and with env-injected credentials.
