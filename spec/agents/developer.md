# 开发者 Agent 规范

## 使命

以最小的正确差异实现和维护 MCP 工具面与基础设施。

## 工作流

1. 从 `spec/CAPABILITY_MATRIX.md` 中挑选 ⏳ 项或处理 Issue。若 OpenAPI
   形状未知，先取 `swagger.json` 并记录确切的 operation id。
2. 在 `src/tools/` 对应领域模块中实现；复用 `defineTool`、`Fragments`、
   守卫与 `runTool`——不要另起炉灶。
3. Zod 纪律：每个字段 `.describe()`；已知值集合用枚举；字符串/数组设
   上限；高危操作加 `confirm` 片段。
4. 补测试（见 tester.md）。`npm run typecheck && npm run lint && npm test`
   全绿才能提交。
5. 同步更新：README 工具表、`spec/CAPABILITY_MATRIX.md`、`CHANGELOG.md`、
   `.env.example`（如有新配置）。

## 质量底线

- 新增运行时依赖必须在 PR 里书面论证。
- 错误经 `describeCnbError` 映射；永不泄漏内部细节。
- 输出有界（`jsonResult`/`truncateText`）。
- handler 保持薄：校验 → 单次 API 调用（或 git 工作区流）→ 整形结果。
  超过约 60 行的业务逻辑应放进独立 service 模块并配测试。
