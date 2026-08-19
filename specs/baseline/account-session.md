---
id: baseline-account-session
title: 账号与会话基线
status: implemented
updated: 2026-08-18
---

# 账号与会话基线

## 目标与范围

应用在本机首次启动时创建一个本地账号，后续使用用户名和密码登录，并在本地保存当前会话。当前没有注册第二账号、账号同步、找回密码或服务端认证。

## 用户流程与规则

- `get_boot_state` 返回是否需要初始化和当前会话。
- 首次创建账号时用户名为 2 至 24 个字符、密码至少 6 个字符；已有账号后拒绝再次初始化。
- 登录要求用户名和密码非空，用户名按 SQLite `NOCASE` 匹配。
- 密码使用 Argon2 加盐哈希；登录失败统一返回“用户名或密码错误”。
- 登录后把用户 ID 写入 `app_settings.active_user_id`，退出时删除该设置。
- “显示已完成/已失败”复用账号级 `show_completed` 偏好，新账号和 v5 升级账号默认关闭；启动、登录和恢复活动会话时通过 `UserSession.showCompleted` 返回。
- 修改显示偏好时只更新当前会话用户；前端保存成功后再切换状态，退出登录时清理页面内偏好，避免账号间泄漏。

## 数据与接口

- 表：`users(id, username, password_hash, created_at, show_completed)`、`app_settings(setting_key, setting_value)`。
- command：`get_boot_state`、`create_account`、`login_user`、`logout_user`、`save_user_show_completed`。
- 类型：`BootState`、`UserSession`、`AccountInput`。
- 浏览器演示模式使用带演示账号 ID 的 `localStorage` 键保存同一偏好，刷新后恢复。

## 边界与验收

- 无活动会话时，任何分类或事项 command 必须拒绝访问。
- 用户名唯一且大小写不敏感，不保存明文密码。
- 创建、登录、退出、错误密码、v5 至 v6 迁移、偏好持久化和用户隔离由 Rust 测试覆盖。

## 实现证据

- 前端：`desktop-client/src/App.vue`、`desktop-client/src/api/native.ts`。
- 原生层：`tauri-desktop/src-tauri/src/lib.rs`、`db.rs`、`models.rs`。
- 持久化：`db.rs` 的 v1 schema、v6 迁移和账号相关测试。
