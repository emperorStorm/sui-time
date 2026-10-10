---
id: baseline-mobile-client
title: 移动端客户端基线
status: implemented
updated: 2026-10-10
---

# 移动端客户端基线

## 目标与范围

安卓移动端客户端（`uni-client/`，UniApp），提供事项、规划（月历）、日记、目标、我的五个 Tab、事项编辑底部弹层、纪念日，以及应用内下载 APK 后唤起系统安装。数据本地存储独立实现，与桌面端 SQLite 不互通。

## 技术栈与结构

- UniApp（Vue 3、纯 JS、rpx），CLI 构建：`npm run dev:h5` / `build:h5` / `build:app`。
- 页面：`pages/tasks`、`pages/planning`、`pages/diary`、`pages/goals`、`pages/profile`，原生 tabBar 五项；纪念日从我的页面进入。
- 组件：`TaskEditSheet`（事项编辑底部弹层）、`UpdateSheet`（检查更新弹层）。
- 数据：`api/storage.js`（`uni.setStorageSync`，key `sui-time-mobile:v1`）、`api/store.js`（业务访问层）、`api/update.js`（更新检查）。
- 字段语义对齐 `desktop-client/src/types.ts`；`utils/occurrence.js` 复刻桌面重复实例展开。

## 业务规则

- 本地账号独立使用：首次启动写入演示种子数据，可新建/编辑/删除/完成事项、维护分类，无登录与同步。
- 事项分组：今天（重复实例命中当日或计划日=今日）/ 7天内 / 稍后；分类筛选；`hideCompleted` 开关隐藏已完成。
- 月历 42 格、周一起始，每天最多显示 2 条待办／纪念日与 `+N` 溢出，点日期展开当天列表，可编辑当次事项或新建（预填日期）。
- 重复规则首版仅 none/daily/weekly/monthly/yearly，编辑页不展示高级选项。
- 完成事项时级联完成其子任务；空标题保存时 toast 校验。
- 列表编辑重复源规则，月历编辑当次覆盖，完成当次不结束源规则；改期到同一天的多个实例均展示。
- 完成／失败置底，有时间优先，再按时间与四象限排序；待办显示 I／II／III／IV，完成／失败显示 ✓／×。
- 支持全天、时间点与时间段，结束时间必须晚于开始，时间精度为 `HH:mm`。父事项首次设具体时间默认 `[0]`；再次修改保留选择，手动关闭保持，切全天或清时间后清空提醒。
- 六个提醒偏移为 0／5／15／30／60／120 分钟，最多三个，子事项不单独提醒。旧数据缺失字段按空值处理，不批量开启旧提醒。
- 父子事项同次严格落盘；删除所有子事项也保存空列表。存储失败保留输入，不提示成功、不调度未保存数据。新增子事项及 Enter 中间插入后聚焦并滚动到新行。

## 安卓原生提醒

- `api/reminders.js` 合并同步请求；`ReminderBridge` 串行更新稳定标识的系统闹钟，SharedPreferences 保存必要快照和待发标识。
- `ReminderEngine` 按现有五种规则及单次覆盖计算每个偏移下一次未来触发，使用本地时区、分钟的 00 秒；广播触发后继续排下一次，过去提醒不补发。
- 启动、保存、状态变更、删除、恢复数据与权限返回时同步。设备重启、升级、时间与时区改变时广播恢复，不依赖 JS 进程、常驻服务或唤醒锁。
- 提供通知与精确闹钟权限、设置入口和测试通知。权限未开仍保存配置，界面区分保存、排程与展示；厂商省电、强制停止、免打扰及关闭渠道仍可能阻断或延迟。

## 更新检查（安卓）

- App 端检查 OSS 的 `sui-time/latest-android.json`，优先与运行时 `versionCode` 比较，旧清单回退语义版本；H5 使用构建版本。
- 更新说明仅从清单 `notes` 读取，不请求 GitHub compare。网络失败与清单错误明确提示，不误报最新。
- 点「立即更新」使用 `plus.downloader` 下载并显示进度，完成后 `plus.runtime.install` 唤起系统安装。支持去重、取消与重试；未知来源授权返回后继续安装，用户取消保留重新安装入口，只有实际运行版本变更才确认升级。
- 浏览器下载为用户主动选择的降级入口，与应用内下载使用同一个 OSS 地址；不回退 GitHub。
- H5 端固定返回"已是最新"演示态。
- `latest-android.json` 格式：`{ "version", "versionCode", "notes", "url", "pubDate" }`，兼容缺失 `versionCode` 的旧清单。

## APK 打包

- APK 由 CI 离线打包自动构建：打 `v*` tag（或手动 dispatch `android-apk.yml`）后，GitHub Actions 执行 `npm run build:app` → 从 OSS 拉取 DCloud 离线打包 SDK（`sui-time/sdk/Android-SDK-5.24.zip`，常驻 OSS）→ `scripts/prepare-android.mjs` 组装安卓工程（`uni-client/android/`，不入库）→ Gradle 用仓库 Secrets 里的 keystore 签名打包。
- `uni-client/android-templates/` 为离线打包模板（manifest/control 用占位符）；`scripts/prepare-android.mjs` 注入 appkey、版本号、签名配置与 uni-app www 资源。
- DCloud 离线打包 Key 存于 Secrets `DCLOUD_APPKEY`；appid `__UNI__DACC2E3`，包名 `fun.upup.suitime`，证书为自生成 keystore（必须离线备份，丢失后已装用户无法升级）。
- APK 上传后，共用 `scripts/generate-android-update.mjs` 从公开 OSS 地址完整下载并核对大小及 SHA-256，成功才生成上传清单；失败保留线上旧清单。两个发布入口统一调用 `android-apk.yml`，桌面 OSS 同步不重复覆盖安卓清单。
- 清单地址来自现有 `ALIYUN_OSS_BASE_URL`；OSS 默认 endpoint 返回 `ApkDownloadForbidden` 时需配置可用 HTTPS CNAME，不能靠更换下载组件解决。

## 验收与证据

- H5 构建 `npm run build:h5` 与移动视口 Playwright 主流程：三 Tab 切换、筛选、分组、完成切换、新建（含空标题校验）、月历渲染与切换、我的页与更新弹层、数据持久化。
- APP 端资源构建 `npm run build:app` 通过。
- `npm test` 覆盖时间、实例、存储失败、并发同步及更新状态；生成安卓工程后执行 `testDebugUnitTest assembleDebug` 覆盖原生计算和打包。
- 前台／后台／锁屏／退出进程／重启后的通知，以及真实 APK 下载／安装／升级数据保留，需要安卓真机验收，浏览器或模拟调用不作为送达证据。
