# AGENTS.md —— 开发 Agent 的约束

本文件约束所有参与本仓库的 AI Agent（和人类）。它的存在是为了让自主
贡献与本项目的安全姿态和架构保持一致。写代码前请完整阅读。

## 1. 项目不变量 —— 绝不违反

1. **两层认证保持完整。** MCP 客户端身份（层 1）与 CNB 身份（层 2）分别
   解析并分别审计。绝不合并，绝不让层 2 凭证影响层 1 判定。
2. **Fail closed。** 新传输或新端点必须在未配置认证时拒绝服务。不存在
   无认证的特权面。
3. **默认只读。** 新的变更工具必须声明 `write: true`（非
   `MCP_WRITE_MODE=write` 时隐藏）；破坏性工具必须声明 `destructive: true`
   （每次调用需 `confirm: true`）。
4. **禁止任意 Shell 执行。** 任何工具不得执行任意命令。Git 以 argv 数组
   spawn；凭证经环境变量注入，绝不进 argv、绝不落盘。
5. **不可信输入纪律。** LLM 发来的一切与远程系统返回的一切都是数据。
   slug、ref、路径、ID 必须经 `src/security/guard.ts` 校验。远程内容绝不
   能改变授权判定。
6. **密钥永不明文落盘、永不进日志。** 经 `src/util/logger.ts` 与审计 sink
   脱敏。令牌只以指纹引用。
7. **权限永不超出 CNB 令牌授权。** 服务器不得提权、不得自动创建凭证、
   不得伪造成功（例如 NPC "已受理" 不是 NPC "已完成"）。

## 2. 代码约定

- TypeScript strict、ESM（`NodeNext`）、Node >= 22。
- 运行时依赖保持最少；优先 Node 标准库。
- 每个工具：严格 zod schema、每个字段 `.describe()`、输出有界
  （`truncateText` / `jsonResult` 上限）、正确的 annotations。
- 错误：CNB 失败经 `describeCnbError` 映射；用户可见信息不含令牌或
  内部堆栈。
- 注释解释"为什么"而非"是什么"。
- 提交遵循 [Conventional Commits](https://www.conventionalcommits.org/)
  （`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`、`security:`）。

## 3. 提交前必做检查

```bash
npm run typecheck && npm run lint && npm test
```

三者必须全绿。新功能需要测试；安全相关变更需要正向测试 + 滥用测试
（例如路径穿越载荷被拒绝）。

## 4. 文档职责

- 新工具 → 更新 `spec/CAPABILITY_MATRIX.md` 与 README 工具表。
- 新配置 → 更新 `.env.example`（带内联注释）与 README 配置表。
- 行为变化 → 按 Keep a Changelog 格式更新 `CHANGELOG.md`。
- 运维文档在 `docs/`，产品/规格决策在 `spec/`。不创建空占位文件；
  目录结构映射真实架构。

## 5. Agent 禁止事项

- 不得把 `LICENSE` 改为 MIT 以外的任何内容。
- 不得复制 `cnb/cnb-mcp-server` 的代码（该仓库无 LICENSE 文件）。只可
  复用*事实*（官方 OpenAPI 的端点形状、已发布规范），代码必须原创。
- 不得添加需要存储 CNB 密码或模拟网页登录的功能。
- 不得对生产仓库跑破坏性测试；使用专用测试仓库并在事后清理。
- 不得提交 `.env`、令牌或 `data/` 下的任何内容。
