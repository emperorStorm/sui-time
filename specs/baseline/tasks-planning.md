---
id: baseline-tasks-planning
title: 事项与时间规划基线
status: implemented
updated: 2026-08-14
---

# 事项与时间规划基线

## 目标与范围

当前用户可以新增、编辑、删除、完成和重新打开事项，并在全部、周、月视图中规划日期。支持全天、时间点、时间段、四象限优先级、备注、分类和子事项。

## 业务规则

- 标题去除首尾空白后为 1 至 120 个字符；日期和时间分别使用 `YYYY-MM-DD`、`HH:mm`。
- `scheduleKind` 只能为 `all_day`、`point`、`range`；时间段必须同时有起止时间且结束晚于开始。
- 优先级只能使用 `Priority` 类型定义的四个值。
- 列表可按搜索词、日期范围和完成状态筛选；查询结果按有日期、日期、时间、创建时间排序。
- 拖动普通事项只更新 `planned_date`；拖到分类只更新分类。
- 删除父事项通过外键级联删除子事项；子事项不独立出现在日期规划视图。
- 所有读写使用当前会话用户作为 `owner_id`，不接受前端传入所有者。

## 数据与接口

- 表：`tasks`，核心字段对应 `Task`/`TaskInput`。
- command：`list_user_tasks`、`save_user_task`、`remove_user_task`、`toggle_user_task`、`reschedule_user_task`。
- 浏览器模式使用 `api/native.ts` 内存演示数据，不代表 SQLite 已写入。

## 验收与证据

- 覆盖标题、日期时间、时间段、优先级、分类所有权、完成切换、删除和用户隔离。
- 前端：`desktop-client/src/App.vue`、`src/types.ts`、`api/native.ts`。
- 原生：`tauri-desktop/src-tauri/src/lib.rs`、`db.rs`、`models.rs`。
