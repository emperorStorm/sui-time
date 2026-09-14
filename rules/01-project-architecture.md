# 项目架构规则

## 技术栈与边界

- `desktop-client/`：Vue 3、`<script setup>`、TypeScript、Vite 和桌面界面。
- `tauri-desktop/`：Tauri CLI、桌面开发与打包脚本。
- `tauri-desktop/src-tauri/`：Rust command、SQLite、系统插件和桌面配置。
- `uni-client/`：UniApp（Vue 3、纯 JS、rpx）安卓移动端，本地存储独立实现，与桌面数据不互通。
- `prototypes/`：脱离生产运行时的可交互原型，不作为业务数据真值。
- `.github/workflows/release.yml`：macOS/Windows 构建、GitHub Release 和 OSS 更新元数据同步。

当前应用只实现本地层。不得把 README 架构图中的同步 API、PostgreSQL 或 OSS 同步规划当作可调用服务。

## 移动端（uni-client）边界

- 页面与逻辑纯前端实现，数据走 `uni.setStorageSync`（key `sui-time-mobile:v1`），不依赖桌面 Rust/SQLite。
- 字段语义对齐 `desktop-client/src/types.ts`；`src/utils/occurrence.js` 复刻桌面重复实例展开。
- APK 由 HBuilderX 云打包/本地打包产出（用户操作），CI 只做 H5 构建校验。
- 安卓更新走 `sui-time/latest-android.json`（OSS），App 内引导浏览器下载 APK 手动安装，不使用 Tauri updater。

## 分层规则

- Vue 页面负责界面编排和页面状态。
- `desktop-client/src/api/native.ts` 负责 Tauri 调用、系统插件和浏览器演示降级。
- `desktop-client/src/types.ts` 定义前端公共数据契约。
- `tauri-desktop/src-tauri/src/lib.rs` 负责 command 暴露和会话门禁。
- `models.rs` 负责序列化输入输出，`db.rs` 负责迁移、校验、事务和持久化。
- 跨日期重复实例等纯前端领域计算放在 `utils/`；具有启动/停止生命周期的能力放在 `composables/`。

## 变更原则

- 优先沿用现有层次，不为单次逻辑引入全局状态库、路由框架或新基础设施。
- 只有被多个调用方复用或明显降低复杂度时才抽公共方法或组件。
- 前后端字段变化必须同步更新 TypeScript 类型、Rust model、command、SQLite 读写和测试。
- 数据库变化必须新增递增迁移，禁止直接改历史迁移来掩盖升级路径。
- 发版配置和密钥只从 GitHub Secrets/Variables 注入，不写入仓库。
