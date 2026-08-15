# 功能 Spec 索引

Spec 记录具体能力的需求、边界、数据契约和验收标准；真实运行代码和数据库是实现状态的最终证据。

## 生命周期

- `draft`：仍在澄清，不能直接作为完整实现依据。
- `approved`：范围、契约和验收条件已确认，可以实施。
- `implemented`：已在真实代码中实现，并记录实现路径和验证证据。
- `superseded`：已被新 Spec 替代，必须填写替代文件。

状态变更必须更新 Spec 正文，不能只改 frontmatter。需求实施时使用 `specs/changes/<功能名>/spec.md`；完成后补真实路径和验证结果，必要时同步基线 Spec。

## 当前基线

| 能力 | Spec |
| --- | --- |
| 账号与会话 | `baseline/account-session.md` |
| 分类管理 | `baseline/categories.md` |
| 事项与时间规划 | `baseline/tasks-planning.md` |
| 重复规则与单次实例 | `baseline/recurrence-occurrences.md` |
| 事项提醒 | `baseline/reminders.md` |
| 逾期待办顺延 | `baseline/overdue-rescheduling.md` |
| 加密备份与恢复 | `baseline/backup-restore.md` |
| 更新与通知中心 | `baseline/update-notifications.md` |

移动端、云同步、PostgreSQL 和业务服务器不属于当前基线。
