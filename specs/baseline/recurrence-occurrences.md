---
id: baseline-recurrence-occurrences
title: 重复规则与单次实例基线
status: implemented
updated: 2026-08-19
---

# 重复规则与单次实例基线

## 目标与范围

事项可按日、间隔日、周、工作日、月、年、记忆曲线或自定义槽位重复，并允许对某一次实例完成、失败、移动、编辑或删除，而不改写其他实例。

## 业务规则

- `repeat_rule` 保存 `RepeatRule` JSON；`kind=none` 表示普通事项。
- 重复类型包括 `daily`、`every_days`、`weekly`、`weekly_slots`、`workdays`、`monthly`、`monthly_slots`、`yearly`、`memory`、`custom`。
- 结束方式支持永不结束、截止日期和次数；间隔最小值为 1。
- 单次实例 ID 使用 `<sourceId>@<date>`，差异按源日期写入 `occurrence_overrides`。
- 单次完成、失败、移动和删除只改变对应 override；失败实例同时保存去除首尾空白、最多 1000 字的可空 `failureReason`，基础重复事项保持 `todo`。
- 记忆曲线使用起始日后第 1、3、7、14、29 天。

## 数据与接口

- `tasks.repeat_rule`、`tasks.occurrence_overrides` 为 JSON 文本。
- 展开逻辑：`desktop-client/src/utils/task-occurrence.ts`。
- 单次实例保存最终仍通过 `save_user_task` 更新基础事项的 overrides。

## 验收与证据

- 覆盖各规则日期匹配、结束条件、实例完成/失败/恢复、移动实例、删除实例和重复事项全局状态归零。
- Rust 校验 JSON 合法性并测试 v5、v7 迁移；前端工具函数是实例展开真值。
