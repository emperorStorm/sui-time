---
id: baseline-reminders
title: 事项提醒基线
status: implemented
updated: 2026-08-14
---

# 事项提醒基线

## 目标与范围

桌面客户端可为有日期和时间的非子事项设置最多三个提醒，并在应用运行期间通过系统通知发送。应用关闭期间没有后台提醒保证。

## 业务规则

- 只有非全天、同时有 `plannedDate` 和 `plannedTime` 的父事项可设置提醒。
- 允许的提前分钟数由 Rust 白名单校验，数组必须递增、无重复且最多三个。
- 调度器每 30 秒检查一次，并在窗口聚焦或重新可见时补查。
- 只发送触发时间后 15 分钟宽限期内的提醒；已发送记录保留 7 天。
- 重复事项先按目标日期展开，再使用实例 ID、日期、偏移和触发时间去重。
- 通知权限未授权或非 Tauri 运行时不发送。

## 数据与接口

- `tasks.reminder_offsets` 在 SQLite 中保存 JSON 数组，对外为 `number[]`。
- 发送记录保存在 `localStorage`：`sui-time:reminder-deliveries:<userId>`。
- 实现：`desktop-client/src/composables/use-task-reminders.ts` 和通知插件。

## 验收与证据

- Rust 测试覆盖合法、乱序、超量、非法偏移和无时间情况。
- 前端验收覆盖授权、启动停止、去重、重复实例和登出后的调度器清理。
