---
id: baseline-mobile-client
title: 移动端客户端基线
status: implemented
updated: 2026-09-14
---

# 移动端客户端基线

## 目标与范围

安卓移动端客户端（`uni-client/`，UniApp），提供事项、规划（月历）、我的三个 Tab，事项编辑底部弹层，以及检查更新引导下载 APK。首版面向安卓，数据本地存储独立实现，与桌面端 SQLite 不互通。

## 技术栈与结构

- UniApp（Vue 3、纯 JS、rpx），CLI 构建：`npm run dev:h5` / `build:h5` / `build:app`。
- 页面：`pages/tasks`、`pages/planning`、`pages/profile`，原生 tabBar 三项。
- 组件：`TaskEditSheet`（事项编辑底部弹层）、`UpdateSheet`（检查更新弹层）。
- 数据：`api/storage.js`（`uni.setStorageSync`，key `sui-time-mobile:v1`）、`api/store.js`（业务访问层）、`api/update.js`（更新检查）。
- 字段语义对齐 `desktop-client/src/types.ts`；`utils/occurrence.js` 复刻桌面重复实例展开。

## 业务规则

- 本地账号独立使用：首次启动写入演示种子数据，可新建/编辑/删除/完成事项、维护分类，无登录与同步。
- 事项分组：今天（重复实例命中当日或计划日=今日）/ 7天内 / 稍后；分类筛选；`hideCompleted` 开关隐藏已完成。
- 月历 42 格、周一起始，每天最多显示 2 条事项与 `+N` 溢出，点日期新建（预填日期）。
- 重复规则首版仅 none/daily/weekly/monthly/yearly，编辑页不展示高级选项。
- 完成事项时级联完成其子任务；空标题保存时 toast 校验。

## 更新检查（安卓）

- App 端检查 `https://<OSS_BASE_URL>/sui-time/latest-android.json`，与当前版本号比较。
- 发现新版本后优先读取 GitHub compare 提交记录作为更新说明，失败回退 manifest 的 `notes`。
- 点「下载更新」调用 `plus.runtime.openURL` 打开 APK 直链，由系统浏览器下载后用户手动安装（降级方案，无进度条）。
- H5 端固定返回"已是最新"演示态。
- `latest-android.json` 格式：`{ "version", "notes", "url", "pubDate" }`，由发布流程在 APK 上传后生成。

## APK 打包

- APK 由 CI 离线打包自动构建：打 `v*` tag（或手动 dispatch `android-apk.yml`）后，GitHub Actions 执行 `npm run build:app` → 从 OSS 拉取 DCloud 离线打包 SDK（`sui-time/sdk/Android-SDK-5.24.zip`，常驻 OSS）→ `scripts/prepare-android.mjs` 组装安卓工程（`uni-client/android/`，不入库）→ Gradle 用仓库 Secrets 里的 keystore 签名打包。
- `uni-client/android-templates/` 为离线打包模板（manifest/control 用占位符）；`scripts/prepare-android.mjs` 注入 appkey、版本号、签名配置与 uni-app www 资源。
- DCloud 离线打包 Key 存于 Secrets `DCLOUD_APPKEY`；appid `__UNI__SUI_TIME`，包名 `fun.upup.suitime`，证书为自生成 keystore（`~/sui-time-release/sui-time-android.keystore`，**必须离线备份**，丢失后已装用户无法升级）。
- APK 上传 GitHub Release 与 OSS 后生成 `latest-android.json`。
- 阿里云 OSS 默认域名禁止分发 `.apk`（`ApkDownloadForbidden`），因此 `latest-android.json` 的 `url` 指向 GitHub Release 下载地址；若后续绑定自定义域名（CNAME）则可改回 OSS。

## 验收与证据

- H5 构建 `npm run build:h5` 与移动视口 Playwright 主流程：三 Tab 切换、筛选、分组、完成切换、新建（含空标题校验）、月历渲染与切换、我的页与更新弹层、数据持久化。
- APP 端资源构建 `npm run build:app` 通过。
- 真机安装、真实更新下载/安装需用户打包后在安卓设备验收。
