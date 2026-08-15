---
id: baseline-account-session
title: 账号与会话基线
status: implemented
updated: 2026-08-14
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

## 数据与接口

- 表：`users(id, username, password_hash, created_at)`、`app_settings(setting_key, setting_value)`。
- command：`get_boot_state`、`create_account`、`login_user`、`logout_user`。
- 类型：`BootState`、`UserSession`、`AccountInput`。

## 边界与验收

- 无活动会话时，任何分类或事项 command 必须拒绝访问。
- 用户名唯一且大小写不敏感，不保存明文密码。
- 创建、登录、退出和错误密码由 Rust 内存数据库测试覆盖。

## 实现证据

- 前端：`desktop-client/src/App.vue`、`desktop-client/src/api/native.ts`。
- 原生层：`tauri-desktop/src-tauri/src/lib.rs`、`db.rs`、`models.rs`。
- 持久化：`db.rs` 的 v1 schema 和账号相关测试。
