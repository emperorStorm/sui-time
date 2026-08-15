---
id: baseline-backup-restore
title: 加密备份与恢复基线
status: implemented
updated: 2026-08-14
---

# 加密备份与恢复基线

## 目标与范围

用户可把本机 SQLite 数据导出为加密的 `.suitime-backup` 文件，并使用同一密码恢复。该能力只在 Tauri 桌面运行时可用。

## 业务规则

- 导出先通过 SQLite backup API 生成一致性快照，再用随机 salt、Argon2 派生密钥和 AES-256-GCM 加密。
- 文件使用 `SUITIME-BACKUP-1` 魔数，包含 salt、nonce 和密文。
- 备份密码至少 8 个字符；导入文件上限 512 MiB。
- 恢复前验证文件结构、密码、SQLite `quick_check`、必要表和 schema 版本。
- 恢复时先保存当前数据库安全副本，再替换主数据库；失败不得留下半写入主库。
- 成功恢复后由前端重新加载应用状态。

## 接口与数据

- 前端：`exportEncryptedBackup`、`restoreEncryptedBackup`，通过系统文件选择器取得路径。
- command：`backup_app_data_command`、`restore_app_data_command`。
- Rust：`backup_app_data`、`restore_app_data` 及加解密、校验辅助函数。

## 验收与证据

- 测试覆盖错误密码、正确解密、恢复后用户数据存在和数据库完整性。
- 桌面验收需实际取消选择、错误密码、成功导出和成功恢复路径。
