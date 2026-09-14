# 岁岁时光

岁岁时光是一款本地优先的个人待办与时间规划应用，包含桌面端与安卓移动端。当前版本为 `0.4.0`。桌面端使用 Vue 3、TypeScript、Tauri 2、Rust 和 SQLite 构建；移动端使用 UniApp，数据保存在本机，不依赖业务服务器或云端账号。

![岁岁时光本地优先数据架构](docs/assets/sui-time-local-first-sync.png)

> 架构图中的云同步、PostgreSQL 和 OSS 数据同步属于后续演进方向。当前运行时只实现本地层：桌面端为 Tauri + SQLite，移动端为 UniApp + 本地存储；OSS 仅用于发布更新资产。

## 当前能力

桌面端：

- 本地账号初始化、登录、会话保持和退出登录。
- 分类新增、编辑、删除、颜色、图标和顺序管理。
- 事项新增、编辑、删除、完成、重新打开、搜索和日期范围筛选。
- 全天、时间点、时间段、四象限优先级、备注和子事项。
- 全部事项看板、周计划、月计划，以及跨日期和分类拖放。
- 日、间隔日、周、工作日、月、年、记忆曲线和自定义重复规则。
- 对单个重复实例完成、移动、编辑或删除，不影响其他实例。
- 最多三个事项提醒；应用运行期间通过系统通知发送并避免重复提醒。
- 未完成、非重复的一次性逾期待办在读取时顺延到本机当天。
- 使用 Argon2 和 AES-256-GCM 的加密备份与恢复。
- 启动自动检查、关于页手动检查、应用内更新通知、下载进度、失败重试、安装和重启。

移动端（安卓，UniApp）：

- 事项：分类筛选、今天/7天内/稍后分组、完成切换、隐藏已完成。
- 规划：月历视图、上下月切换、点日期新建事项。
- 我的：资料、隐藏完成开关、恢复演示数据、检查更新（引导下载 APK）。
- 数据本地存储独立实现，与桌面 SQLite 不互通；APK 由 CI 离线打包自动构建（打 `v*` tag 触发），发布在 GitHub Release，App 内检查更新后浏览器下载安装。

## 项目结构

```text
sui-time/
├── desktop-client/              # Vue 3 + TypeScript 桌面界面
├── tauri-desktop/               # Tauri CLI、桌面开发和打包入口
│   └── src-tauri/               # Rust command、SQLite、系统插件和桌面配置
├── uni-client/                  # UniApp 安卓移动端（Vue 3、纯 JS、本地存储）
├── prototypes/                  # 可维护源码与单 HTML 交互原型
├── specs/                       # 功能基线、变更需求和验收证据
├── rules/                       # 长期项目架构、编码和验证规则
├── docs/                        # 架构图与品牌资料
├── AGENTS.md                    # AI Coding 唯一规则入口
└── .github/workflows/release.yml # macOS、Windows、Release 与 OSS 更新流程
```

生产数据调用链如下：

```text
Vue 页面
  -> desktop-client/src/api/native.ts
  -> Tauri command（tauri-desktop/src-tauri/src/lib.rs）
  -> 数据与事务（tauri-desktop/src-tauri/src/db.rs）
  -> sui-time.sqlite3
```

前端只通过 `native.ts` 访问原生能力，不直接读写 SQLite。浏览器开发模式使用内存演示数据，仅用于界面调试，不代表数据已经写入数据库。

## 本地数据与安全

- 数据库文件名为 `sui-time.sqlite3`，由 Tauri 写入操作系统分配的应用数据目录。
- 当前数据库 Schema 为 v5，保存账号、活动会话、分类、事项、重复实例差异和提醒配置。
- 密码使用 Argon2 加盐哈希，不保存明文密码。
- 所有分类和事项读写都以当前本机会话用户作为所有者，前端不能指定其他用户。
- 通知中心的已读状态保存在 `localStorage` 的 `sui-time:notifications`。
- 提醒送达记录按用户保存在 `sui-time:reminder-deliveries:<userId>`，用于避免重复通知。
- 备份文件扩展名为 `.suitime-backup`，密码至少 8 位；恢复前会校验文件、密码、SQLite 完整性和 Schema 版本。
- 恢复数据前会先保存当前数据库的加密回滚备份，失败时不会保留半写入的主数据库。

## 提醒与重复事项

提醒仅适用于同时设置日期和时间的父事项。调度器在应用运行期间每 30 秒检查一次，并在窗口重新聚焦或恢复可见时补查；应用完全退出后不保证后台提醒。

重复事项以基础事项和单次实例差异共同表达。单次实例 ID 使用 `<sourceId>@<date>`，移动、编辑、完成和删除单次实例只更新对应差异，不会改写其他日期的实例。

## 自动更新

桌面端通过 Tauri updater 完成更新检查、签名校验、下载、安装和重启：

1. 通知中心在 Tauri 环境启动后自动检查；关于页面复用同一入口手动检查。
2. 同一时刻共享一个检查 Promise，避免自动和手动请求重复执行。
3. 新版本以 `app-update:<version>` 去重并写入应用内通知。
4. 更新说明优先读取 GitHub compare 提交记录；请求失败时回退到更新包携带的 release notes。
5. 用户确认后下载并安装更新，展示进度和失败信息，安装完成后重启应用。

仓库中的基础 `tauri.conf.json` 默认不包含更新端点和公钥，避免本地开发误连发布环境。发布时由 `tauri-desktop/scripts/prepare-release-config.mjs` 根据以下环境变量生成临时发布配置：

- `TAURI_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（私钥有密码时）
- `ALIYUN_OSS_BASE_URL`
- `ALIYUN_OSS_BUCKET`
- `ALIYUN_OSS_ENDPOINT`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`

GitHub Actions 构建 macOS 与 Windows 安装包、签名更新资产并创建 Release，随后把不可变安装包和当前 `latest.json` 同步到 OSS。密钥只能配置在 GitHub Secrets/Variables，禁止写入仓库。

安卓移动端不使用 Tauri updater。App 内”检查更新”读取 OSS 的 `sui-time/latest-android.json`，发现新版本后用系统浏览器打开 APK 直链下载，用户手动安装。APK 由 CI 离线打包自动构建（`uni-client/android-templates/` + `scripts/prepare-android.mjs`，依赖 DCloud 离线打包 Key 与 OSS 上常驻的离线 SDK），打 `v*` tag 后自动上传 GitHub Release 并生成 `latest-android.json`。注意阿里云 OSS 默认域名禁止分发 `.apk` 文件，故 `latest-android.json` 的 `url` 指向 GitHub Release 下载地址。

浏览器模式只能验证”当前已是最新版本”的降级分支和通知界面；真实签名、下载、安装和重启必须使用 Tauri 安装包或 CI/Release 环境验证。

## 本地开发

环境要求：Node.js、npm、Rust stable，以及 Tauri 2 对应平台依赖。

首次安装依赖：

```bash
cd desktop-client
npm install

cd ../tauri-desktop
npm install

cd ../uni-client
npm install
```

启动桌面开发环境：

```bash
cd tauri-desktop
npm run tauri:dev
```

仅启动浏览器界面：

```bash
cd desktop-client
npm run dev
```

浏览器界面使用内存演示数据，系统通知、备份恢复、真实更新安装等能力只在 Tauri 桌面环境可用。

启动移动端 H5 预览（移动端开发主入口）：

```bash
cd uni-client
npm run dev:h5
```

移动端 H5 使用本地存储演示数据，端口 5182；APK 打包见 `specs/baseline/mobile-client.md`。

## 构建与验证

```bash
# Vue 类型检查和生产构建
cd desktop-client
npm run build

# Rust 单元测试和格式检查
cd ../tauri-desktop/src-tauri
cargo test
cargo fmt --check

# 移动端 H5 与 APP 资源构建
cd ../../uni-client
npm run build:h5
npm run build:app

# 仓库空白和冲突检查
cd ..
git diff --check
```

普通桌面打包：

```bash
cd tauri-desktop
npm run tauri:build
```

`npm run tauri:build:release` 需要完整发布环境变量，只用于正式签名和更新资产构建。

## AI Coding 资料

- [`AGENTS.md`](AGENTS.md)：Codex 在本仓库工作的唯一强制入口。
- [`rules/README.md`](rules/README.md)：按任务类型路由架构、前端、原生数据、原型和验证规则。
- [`specs/README.md`](specs/README.md)：功能 Spec 生命周期、八项当前基线和后续变更入口。
- [`prototypes/sui-time-reference/README.md`](prototypes/sui-time-reference/README.md)：桌面交互原型、页面清单、状态矩阵、模拟数据边界和单 HTML 交付说明。

原型用于确认视觉与交互，不是生产数据真值。生产行为以 Vue、Tauri command、Rust、SQLite 和对应基线 Spec 为准。

## 当前限制

- 移动端暂无云同步，与桌面数据不互通。
- 当前没有云同步、跨设备同步或业务服务器。
- 当前不使用 PostgreSQL 保存业务数据。
- 提醒依赖应用保持运行并获得系统通知权限。
- 备份恢复和真实更新安装只在 Tauri 桌面运行时可用。
- 安卓 APK 由 HBuilderX 打包，真实安装与更新下载需真机验收。

本地优先架构图的可编辑源文件位于 [`docs/assets/sui-time-local-first-sync.drawio`](docs/assets/sui-time-local-first-sync.drawio)。
