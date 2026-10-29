# Contributing / 贡献指南

[GitHub](https://github.com/htazq/cnb-remote-mcp) · [CNB](https://cnb.cool/htazq/cnb-remote-mcp)

Issues and pull requests are welcome on either source mirror. Keep changes focused, update the Chinese and English user guides together, and never include live credentials or personal deployment configuration. Contributions are released under [MIT](LICENSE).

欢迎在任一源码镜像提交 Issue / PR。保持修改聚焦，中文和英文使用文档同步更新，不提交真实凭证或私人部署配置。贡献按 [MIT](LICENSE) 发布。

## Checks / 检查

Use Node.js >= 22.12. Read [AGENTS.md](AGENTS.md) before making code changes.

使用 Node.js >= 22.12，修改代码前阅读 [AGENTS.md](AGENTS.md)。

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Add meaningful positive and abuse tests for authentication or security changes. Use mock APIs or your own test repositories; never run destructive tests against other users' repositories. Use Conventional Commits, such as `fix(auth): validate redirect URI`.

认证及安全修改需添加正向和滥用测试。使用模拟 API 或自己的测试仓库，不对他人仓库运行破坏性测试。提交使用 Conventional Commits，例如 `fix(auth): validate redirect URI`。

## Mirror identity / 镜像提交身份

The mirrors contain the same released files, but keep independent Git histories so platform-specific email addresses do not cross over. A CNB commit uses the contributor's CNB identity; a GitHub commit uses their GitHub identity (prefer the GitHub-provided noreply address). Configure identity **locally per checkout**; never change global identity as part of a contribution. Maintainers transfer reviewed file changes, not the other mirror's commit history, and verify the resulting file manifest before releasing the same version on both platforms.

镜像发布相同文件，但独立维护历史，避免平台邮箱混用。CNB 提交使用贡献者的 CNB 身份；GitHub 提交使用其 GitHub 身份，优先 GitHub 提供的 noreply 邮箱。身份只在各自本地 checkout 配置，不修改全局身份。维护者同步已审查的文件变更，不同步对方提交历史；发布前核对文件清单，并在两边发布同一版本。

No unattended cross-platform sync is configured by this repository. A release must explicitly update both mirrors. Report vulnerabilities through [SECURITY.md](SECURITY.md), not public issues.

本仓库未配置无人值守跨平台同步，发布需明确更新两边镜像。漏洞按 [SECURITY.md](SECURITY.md) 私密报告，不发布公开 Issue。
