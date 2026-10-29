# 能力对照矩阵

与官方参考实现的覆盖对比。证据列引用官方 OpenAPI 操作或端点。

图例：✅ 已实现 · 🔁 复用契约（规范/端点，非代码）· ⏳ 计划中 ·
🚫 有意不暴露 · ❓ 待外部条件

| 能力                      | 官方 MCP（归档） | cnb-skill         | cnb-cli    | OpenAPI | 本项目                                   | 证据                                                   |
| ------------------------- | ---------------- | ----------------- | ---------- | ------- | ---------------------------------------- | ------------------------------------------------------ |
| **身份**                  |                  |                   |            |         |                                          |                                                        |
| 当前用户                  | ✅               | ✅                | ✅         | ✅      | ✅ `whoami`                              | `GET /user`                                            |
| **仓库**                  |                  |                   |            |         |                                          |                                                        |
| 仓库详情                  | ✅               | ✅                | ✅         | ✅      | ✅ `repo_get`                            | `GET /{repo}`                                          |
| 我的仓库列表              | ✅               | ✅                | ✅         | ✅      | ✅ `repo_list`                           | `GET /user/repos`                                      |
| 搜索公开仓库              | ✅               | ✅                | ✅         | ✅      | ✅ `repo_search`                         | `GET /search/public-repos`                             |
| 创建仓库                  | ❌               | ✅                | ✅         | ✅      | ✅ `repo_create`（写）                   | `POST /{slug}/-/repos`                                 |
| 删除仓库                  | ❌               | ✅                | ✅         | ✅      | 🚫 不提供                                | `DELETE /{repo}` 需身份票据                            |
| **Git 数据**              |                  |                   |            |         |                                          |                                                        |
| 读文件 / 原始内容         | ✅               | ✅                | ✅         | ✅      | ✅ `repo_file_read`                      | `GET /{repo}/-/git/raw/...`                            |
| 列目录 / 树               | ✅               | ✅                | ✅         | ✅      | ✅ `repo_tree_list`                      | `GET /{repo}/-/git/contents`                           |
| 提交列表 / 详情           | ✅               | ✅                | ✅         | ✅      | ✅ `repo_commits_list` `repo_commit_get` | `GET /{repo}/-/git/commits[/...]`                      |
| 比较 / Diff               | ✅               | ✅                | ✅         | ✅      | ✅ `repo_diff_compare`                   | `GET /{repo}/-/git/compare/{base_head}`                |
| 提交状态检查              | ✅               | ✅                | ✅         | ✅      | ✅ `repo_commit_statuses`                | `GET /{repo}/-/git/commit-statuses/{commitish}`        |
| 分支列表/详情/创建        | 部分             | ✅                | ✅         | ✅      | ✅ `repo_branch_*`                       | `…/-/git/branches`                                     |
| 删除分支                  | ❌               | ✅                | ✅         | ✅      | ✅ `repo_branch_delete`（高危）          | `DELETE /{repo}/-/git/branches/{branch}`               |
| 标签列表/创建/删除        | 部分             | ✅                | ✅         | ✅      | ✅ 列表（`repo_tag_list`）               | `…/-/git/tags`                                         |
| **代码写入（git push）**  | ❌               | 经 CLI/本地 git   | 经本地 git | ❌      | ✅ `code_push_files`                     | Git HTTPS + 令牌                                       |
| **Issue**                 |                  |                   |            |         |                                          |                                                        |
| 列表 / 详情 / 创建 / 更新 | ✅               | ✅                | ✅         | ✅      | ✅ `issue_*`                             | `/{repo}/-/issues`                                     |
| 评论列表 / 添加           | ✅               | ✅                | ✅         | ✅      | ✅ `issue_comment_*`                     | `/{repo}/-/issues/{n}/comments`                        |
| 标签 / 处理人管理         | 部分             | ✅                | ✅         | ✅      | 🚫 不提供                                | `…/labels`、`…/assignees` —— Web UI 已覆盖，精简工具面 |
| **Pull Request**          |                  |                   |            |         |                                          |                                                        |
| 列表 / 详情 / 创建 / 更新 | ✅               | ✅                | ✅         | ✅      | ✅ `pr_*`                                | `/{repo}/-/pulls`                                      |
| 文件 / 提交 / 检查        | ✅               | ✅                | ✅         | ✅      | ✅ `pr_files` `pr_commits` `pr_checks`   | `…/files`、`…/commits`、`…/commit-statuses`            |
| 评论                      | ✅               | ✅                | ✅         | ✅      | ✅ `pr_comment_*`                        | `…/comments`                                           |
| 评审列表 / 提交评审       | ✅               | ✅                | ✅         | ✅      | ✅ `pr_review_*`                         | `…/reviews`                                            |
| 合并 PR                   | ✅               | ✅                | ✅         | ✅      | ✅ `pr_merge`（高危）                    | `PUT …/merge`                                          |
| 冲突状态                  | ❌               | ✅                | ✅         | ✅      | ✅ `pr_get.mergeable_state`              | `api.Pull`                                             |
| **CI / 构建**             |                  |                   |            |         |                                          |                                                        |
| 构建历史                  | ✅               | ✅                | ✅         | ✅      | ✅ `build_list`                          | `GET /{repo}/-/build/logs`                             |
| 构建状态                  | ✅               | ✅                | ✅         | ✅      | ✅ `build_status`                        | `GET …/build/status/{sn}`                              |
| 阶段日志                  | ✅               | ✅                | ✅         | ✅      | ✅ `build_stage_logs`                    | `GET …/build/logs/stage/...`                           |
| 触发构建                  | ✅               | ✅                | ✅         | ✅      | ✅ `build_trigger`（写）                 | `POST …/build/start`                                   |
| 取消构建                  | ✅               | ✅                | ✅         | ✅      | ✅ `build_cancel`（写）                  | `POST …/build/stop/{sn}`                               |
| **NPC**                   |                  |                   |            |         |                                          |                                                        |
| `api_trigger_npc` 调度    | ❌               | ✅                | ❌         | ✅      | ✅ `npc_dispatch`                        | `POST …/build/start` + 官方文档                        |
| 任务状态追踪              | ❌               | ✅                | ❌         | ✅      | ✅ `npc_status`                          | `GET …/build/status/{sn}`                              |
| NPC 搜索                  | ❌               | ✅                | ✅         | ✅      | ✅ `npc_search`                          | `GET /search/npc`                                      |
| 观测（动作/推送/PR）      | ❌               | ✅                | ✅         | ✅      | ✅ `npc_actions`                         | `GET …/npc-observability/*`                            |
| **传输 / 认证（服务端）** |                  |                   |            |         |                                          |                                                        |
| STDIO                     | ✅               | —                 | —          | —       | ✅                                       | —                                                      |
| Streamable HTTP           | ✅               | —                 | —          | —       | ✅ 无状态                                | —                                                      |
| PAT 认证                  | ✅ 环境变量      | ✅                | ✅         | ✅      | ✅ 两层                                  | docs:access-token                                      |
| 设备流登录（用户自助）    | ❌               | ✅（`cnb login`） | ✅         | ✅      | 🚫 不提供                                | `cnb login` 产出非永久令牌；直接粘贴为 `CNB_TOKEN`     |
| 审计日志                  | ❌               | —                 | —          | —       | ✅                                       | 本设计                                                 |
| 写模式门控 + 确认         | ❌               | —                 | —          | —       | ✅                                       | 本设计                                                 |

## 有意不提供 🚫

- 仓库/组织/制品库删除（需身份票据，爆炸半径过大）——除非未来有明确的
  管理员工作流，否则不重新考虑。
- 用户资料修改、邮箱/GPG 管理——超出协作范围。
- 制品发布——独立的策略面，非核心协作闭环所需。
- 全量 Swagger 透传——设计上否决（见 ARCHITECTURE D1）。

## 维护策略

每次发版对照线上 `https://api.cnb.cool/swagger.json` 复查本矩阵。官方新
能力先记 ⏳ 候选，实现时补测试与文档，或明确标 🚫 并写明理由。
