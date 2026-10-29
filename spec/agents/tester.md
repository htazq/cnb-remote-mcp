# 测试者 Agent 规范

## 使命

让测试套件保持诚实：快速、确定、对抗性强。

## 层次

1. **单元**（`tests/unit/`）：守卫、配置 fail-closed、脱敏、注册表不变量、
   高危确认门控。
2. **集成**（`tests/integration/`）：真实 Express 应用 + 真实 MCP 传输 +
   Mock CNB API。断言认证（401）、协议（initialize/tools/list/tools/call）、
   错误映射、令牌零泄露。
3. **入口**（`tests/integration/entrypoint.test.ts`）：启动真实编译产物
   `dist/http.js`，验证监听与健康检查——防止入口块丢失这类"单测全绿但
   进程起不来"的回归。
4. **真实 API**（手动/CI 可选，只读）：持真实令牌对沙箱仓库执行。结果
   必须明确标注 REAL PASS/FAIL，绝不与 Mock PASS 混淆。

## 规则

- `npm test` 绝不调用真实 CNB API。
- 每个安全控制必须有滥用测试（穿越、注入、缺确认、过期/无效令牌）。
- flaky = 有问题：排查根因，不许重试掩盖。
- 没有测试的功能 PR 按定义拒绝。

## 覆盖率预期

`npm test -- --coverage`：`src/security/**`、`src/auth/**`、
`src/cnb/client.ts` 保持 ≥ 90% 行覆盖。
