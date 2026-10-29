# Security model / 安全模型

## Independent identities / 两层身份

Client → MCP authenticates using static Bearer keys or the optional owner OAuth facade. MCP → CNB uses only the configured server-side PAT. A valid CNB token never authenticates a client by itself. HTTP startup without configured client keys fails closed.

客户端 → MCP 使用静态 Bearer 密钥或可选所有者 OAuth。MCP → CNB 只使用服务端配置的 PAT；有效的 CNB 令牌本身不能代替客户端认证。未配置客户端密钥时 HTTP 拒绝启动。

Cloudflare Tunnel is transport. It does not replace application authentication. OAuth implementation and lifetimes are documented in [authentication](../docs/authentication.md). Deploy one replica when OAuth is enabled; restart invalidates grants.

Cloudflare Tunnel 只负责传输，不替代应用认证。[认证说明](../docs/authentication.md)记录 OAuth 实现与有效期；启用 OAuth 时使用单副本，重启使授权失效。

## Controls / 控制

| Threat / 威胁                                                     | Control / 控制                                                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthorized writes / 未授权写入                                  | Read-only tool registry by default; write mode and per-call destructive confirmation / 默认只读，写模式与高危操作单次确认                             |
| Callback substitution or code interception / 回调替换或授权码截获 | Exact HTTPS redirects, S256 PKCE, one-use 60-second codes, browser cookie + origin check / 精确回调、PKCE、单次授权码、Cookie 和 Origin 校验          |
| Credential guessing / 凭证猜测                                    | Random 32+ character owner key and client secret, consent attempt limit, SDK OAuth endpoint rate limits / 随机长密钥、授权页尝试限制和 OAuth 端点限流 |
| Path or Git option injection / 路径或 Git 选项注入                | Slug/ref/path validation, isolated workspace, argv-only Git execution / 输入校验、隔离工作区、Git argv 调用                                           |
| Credential exposure through Git / Git 泄露凭证                    | Environment-injected Authorization header; credentials excluded from URL/config/argv / 通过环境注入，不写入 URL、配置或命令参数                       |
| Concurrent overwrites / 并发覆盖                                  | Expected-head lease when supplied; default-branch push requires confirmation / 提供预期提交时使用租约；默认分支推送需确认                             |
| Oversized inputs / 超大输入                                       | Request and file budgets, Git timeout, bounded tool outputs / 请求和文件预算、Git 超时、输出上限                                                      |
| Prompt injection / 提示注入                                       | Remote content remains tool-result data and cannot change server authentication / 远程内容仅作为结果，不能改变服务端授权                              |

## Logging and retention / 日志与保留

Audit goes to stdout and `${MCP_DATA_DIR}/audit.log`, with a 50 MiB local rotation threshold. Log fields with credential-like names and Bearer/Basic patterns are redacted. Arbitrary file contents and operation arguments can still contain private data, so redaction is not a guarantee that logs are safe to publish. OAuth token digests stay in memory. Temporary Git workspaces are removed after each operation; runtime files and audit logs are excluded from source control. No persistent volume is required, but the process does write runtime data to its container filesystem.

审计写入 stdout 及 `${MCP_DATA_DIR}/audit.log`，本地按 50 MiB 阈值轮转。凭证相关字段和 Bearer/Basic 字符串会脱敏，但任意文件内容与操作参数仍可能包含私人数据，因此日志不能未经检查直接公开。OAuth 令牌摘要仅存内存；Git 工作区在每次操作后清理；运行文件和审计不进入版本控制。无需持久卷，但进程确实会写入容器文件系统。

Report vulnerabilities via [SECURITY.md](../SECURITY.md) / 漏洞报告见 [SECURITY.md](../SECURITY.md)。
