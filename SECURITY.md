# Security / 安全

This server grants authorized clients access to the CNB account configured by its operator. Use a narrowly scoped PAT, a separate long random MCP key, and read-only mode for initial setup. OAuth is optional and intended for one owner and one server replica. See [authentication](docs/authentication.md) for token lifetimes, revocation, and restart behavior.

本服务器将运营者配置的 CNB 账号权限授予已授权客户端。请使用最小范围的 PAT、独立随机 MCP 密钥，首次接入保持只读。可选 OAuth 面向单个所有者、单副本部署；令牌时效、撤销和重启行为见[认证说明](docs/authentication.md)。

## Report a vulnerability / 报告漏洞

Use [GitHub private vulnerability reporting](https://github.com/htazq/cnb-remote-mcp/security/advisories/new). Do not put credentials, private endpoints, repository contents, or exploit details in public issues. Include the affected version and minimal reproduction using a repository you own.

请使用 [GitHub 私密漏洞报告](https://github.com/htazq/cnb-remote-mcp/security/advisories/new)。不要在公开 Issue 中提交凭证、私人端点、仓库内容或漏洞利用细节；请提供受影响版本和你自己仓库中的最小复现。

## Data handling / 数据处理

- No analytics or telemetry service is configured by this project. It connects to the configured CNB API/Git service. Cloudflare, your hosting platform, and your MCP client process traffic according to their own policies.
- The CNB PAT stays in the server environment; OAuth access/refresh tokens are stored as digests in memory. Git uses environment-injected credentials and temporary workspaces.
- Audit records go to stdout and a rotating local file and may contain operation data, including repository/file paths and file-change arguments. Automatic credential redaction is not a guarantee that arbitrary content is private: inspect logs before sharing.
- `.env`, private keys, runtime data, and local archives are excluded from Git. Do not put live credentials in examples, screenshots, issue templates, or image build arguments.

- 本项目未配置分析统计或遥测服务；连接的是配置的 CNB API/Git。Cloudflare、容器平台及 MCP 客户端按各自政策处理流量。
- CNB PAT 仅在服务器环境中；OAuth 令牌摘要仅存内存。Git 使用环境注入凭证和临时工作区。
- 审计输出到 stdout 及轮转文件，可能包含仓库/文件路径、文件变更参数等操作数据。自动凭证脱敏不保证任意内容均无隐私；分享前请检查。
- `.env`、私钥、运行数据和本地归档已被 Git 忽略；示例、截图、Issue 及镜像构建参数不得含真实凭证。

See [the security model](spec/SECURITY.md) for implementation details / 实现细节见[安全模型](spec/SECURITY.md)。
