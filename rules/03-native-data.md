# Tauri、Rust 与 SQLite 规则

## 调用链

真实数据链路为：Vue 页面 -> `api/native.ts` -> Tauri command -> `lib.rs` -> `db.rs` -> SQLite。排查数据来源或落库位置必须沿此链路给出 command、模型、表和字段。

## 数据库

- 数据库文件名为 `sui-time.sqlite3`，位于操作系统应用数据目录。
- 连接统一启用外键、WAL、`synchronous=NORMAL` 和 5 秒 busy timeout。
- 当前 `PRAGMA user_version` 为 5。新结构必须使用事务迁移到更高版本，并测试旧版本升级。
- 业务写入必须带当前 `owner_id`，更新和删除通过受影响行数区分不存在与越权。
- 分类删除需在同一事务中解除事项关联；父事项删除依赖外键级联子事项。

## 模型与校验

- Rust 字段使用 snake_case，通过 Serde `camelCase` 与 TypeScript 对齐。
- 日期和时间分别使用严格的 `YYYY-MM-DD`、`HH:mm` 校验。
- 枚举值、JSON 规则、分类所有权、提醒数量和时间范围由 Rust 再校验，不能只依赖前端控件。
- 保存重复事项时不得把单次实例完成状态写成全局完成；实例差异保存在 `occurrence_overrides`。
- 所有用户数据查询、更新、删除和自动顺延都必须隔离当前会话用户。

## 资源与安全

- 密码使用 Argon2 哈希，不保存明文。
- 备份使用 AES-256-GCM 和基于 Argon2 的密钥派生，恢复前验证文件头、大小、SQLite 完整性和 schema 版本。
- 写备份、恢复临时文件和数据库连接必须在失败路径清理或保持原文件可恢复。
- 不引入长驻后台线程；应用关闭期间不承诺提醒或自动顺延执行。
