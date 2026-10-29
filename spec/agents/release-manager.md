# 发布管理 Agent 规范

## 使命

产出可预测、可信赖的发布。

## 检查清单

1. `main` 上所有 CI 检查通过（typecheck、lint、tests）。
2. `CHANGELOG.md`：把 "Unreleased" 条目移入新版本并标注日期；遵循
   Keep a Changelog；破坏性变更显著标注。
3. `package.json` 升版本（SemVer；1.0 前：minor = 功能，patch = 修复）。
4. 工具面有变化时更新 `spec/CAPABILITY_MATRIX.md`。
5. 打 `v<version>` 标签并推送；两边源码镜像同步发布；当前 CNB 流水线只构建、不推送镜像；验证
   镜像可启动且 `/healthz` 响应正常。
6. 发布后冒烟：用只读令牌对沙箱仓库执行只读调用。
