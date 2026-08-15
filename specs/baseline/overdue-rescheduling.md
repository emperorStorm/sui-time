---
id: baseline-overdue-rescheduling
title: 逾期一次性待办自动顺延基线
status: implemented
updated: 2026-08-14
---

# 逾期一次性待办自动顺延基线

## 目标与范围

当前用户未完成、非重复、非子事项的一次性逾期待办在下次读取时直接顺延到本机当天，并保留原时间点、时间段或全天设置。

## 业务规则

- 条件：当前 `owner_id`、`status=todo`、存在日期、`planned_date < today`、`parent_task_id IS NULL`、合法 `repeat_rule` 且 `kind=none`。
- 只更新 `planned_date` 和 `updated_at`，不修改时间、优先级、分类、备注和完成状态。
- 已完成、重复、无日期、子事项和其他用户事项不受影响。
- `list_user_tasks` 查询前执行顺延；Vue 在跨本地零点后刷新，退出和卸载时清理定时器。
- 应用关闭期间不逐日运行，下次启动或刷新时从旧日期直接移动到当天。

## 接口与数据

- Rust：`db.rs::reschedule_overdue_tasks`、`today_string`。
- command 链路：`lib.rs::list_user_tasks`。
- 前端：`App.vue::scheduleMidnightRefresh`。
- 无新增表字段。

## 验收与证据

- Rust 测试覆盖时间保留和所有排除条件。
- 前端构建验证跨零点刷新调用和生命周期清理可编译。
