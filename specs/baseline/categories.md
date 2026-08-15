---
id: baseline-categories
title: 分类管理基线
status: implemented
updated: 2026-08-14
---

# 分类管理基线

## 目标与范围

当前用户可以维护用于事项分组的分类，包括名称、颜色、图标和顺序。分类只属于当前用户，不提供跨用户共享。

## 业务规则

- 名称去除首尾空白后为 1 至 20 个字符，同一用户内唯一。
- 颜色必须为合法十六进制颜色，图标必须属于原生层允许清单。
- 列表按 `sort_order`、名称排序。
- 删除分类时在同一事务中把当前用户关联事项的 `category_id` 置空，再删除分类。
- 其他用户不能查询、修改、删除或把事项绑定到该分类。

## 数据与接口

- 表：`categories(id, owner_id, name, color, icon, sort_order, created_at, updated_at)`。
- 事项关联：`tasks.category_id`，分类删除后保留事项。
- command：`list_user_categories`、`save_user_category`、`remove_user_category`。
- 类型：`Category`、`CategoryInput`。

## 验收与证据

- 覆盖新增、编辑、重复名称、非法颜色/图标、删除解绑和事务失败回滚。
- 前端入口：`desktop-client/src/App.vue`、`api/native.ts`。
- 原生实现与测试：`tauri-desktop/src-tauri/src/db.rs`。
