---
id: desktop-prototype-alignment
title: 桌面端原型融合与中文文档收口
status: implemented
updated: 2026-08-16
---

# 桌面端原型融合与中文文档收口

## 目标

在不改变生产数据模型和核心业务行为的前提下，将桌面客户端统一为深色山景侧栏、蓝色强调色和高信息密度工作区，并把根 `README.md` 收口为唯一中文项目说明。

## 范围

- 本期包含：桌面端视觉变量、侧栏与工作区布局、账户菜单层级、弹层和通知视觉、浏览器版本降级值、中文 README。
- 本期包含：验证账号会话、分类、事项、周月规划、重复实例、提醒、逾期顺延、备份恢复和更新通知入口仍然可用。
- 本期不包含：Tauri command、Rust model、SQLite Schema、移动端、云同步和业务服务器。
- 原型仅提供视觉与交互参考，不把 `tags/tagId`、`date/time` 等模拟字段引入生产代码。

## 用户流程

1. 用户登录后通过深色侧栏进入全部事项、我的一周、我的一月和分类管理。
2. 用户可打开账户菜单进入分类、关于页面或退出登录，菜单不被导航层遮挡。
3. 用户继续使用新增、编辑、删除、完成、拖放、日期时间、重复、提醒和子事项能力。
4. 用户在关于页面手动检查更新，或通过通知中心查看自动检查产生的更新通知。
5. 用户可在关于页面打开加密备份和恢复入口；浏览器环境明确提示该能力仅限桌面客户端。

## 业务规则

- 生产端保留现有 Vue 状态、`native.ts` 请求层、Tauri command 和 SQLite 持久化链路。
- 自动检查与手动检查继续复用通知中心的同一进行中 Promise，更新通知继续使用 `sui-time:notifications` 持久化和 `app-update:<version>` 去重。
- 浏览器演示版本与当前应用版本统一为 `0.3.0`；真实 Tauri 环境仍以 `getVersion()` 返回值为准。
- 所有新增图片和图标必须本地化，不增加 CDN、远程字体或热链。
- 侧栏菜单、通知面板和业务弹层必须具有明确层级，不允许互相遮挡。

## 接口契约

无运行时接口变化。保留 `checkAppUpdate`、`installAppUpdate`、`exportEncryptedBackup`、`restoreEncryptedBackup` 以及现有 Tauri command 输入输出。

## 数据结构

无 TypeScript 公共类型、Rust 类型、SQLite 表字段或迁移变化。

## 异常与边界

- 浏览器环境检查更新返回当前版本但不伪造远程更新；备份恢复继续返回桌面能力提示。
- 更新检查失败时保留手动重试入口；更新下载或安装失败时保留错误信息和再次操作能力。
- 最小窗口 `1100 x 720` 下侧栏、周月视图、事项弹层和更新弹层不得重叠或越界。
- 用户已有未提交的通知 Teleport、弹层动画和原型交互修复必须保留。

## 验收条件

- [x] 账户菜单中的分类管理、关于岁岁时光和退出登录可点击。
- [x] 全部事项、周视图、月视图、分类和关于页面布局完整。
- [x] 事项新增、编辑、删除、完成、拖放、日期时间、重复、提醒和子事项保持可用。
- [x] 自动检查、手动检查、通知持久化、更新详情、下载进度、失败提示、安装和重启调用链保持不变。
- [x] 备份与恢复入口可达，浏览器环境显示真实能力边界。
- [x] `1100 x 720`、`1360 x 900`、`1440 x 900` 无明显遮挡、溢出或不可点击区域。
- [x] 前端构建、Rust 测试、Rust 格式检查和 `git diff --check` 通过。

## 实现证据

- 视觉与布局：`desktop-client/src/App.vue`、`desktop-client/src/styles/app.css`、`desktop-client/src/assets/sidebar/mountain-surface.svg`。
- 更新与版本：`desktop-client/src/components/AppNotificationCenter.vue` 保留通知持久化、检查去重、下载、安装和重启链路；`desktop-client/src/api/native.ts` 与 `desktop-client/src/App.vue` 的浏览器初始版本统一为 `0.3.0`。
- 中文文档：根 `README.md` 已成为唯一中文说明，重复的 `README.zh-CN.md` 已删除。
- 生产端浏览器验收：账户菜单、全部事项、周视图、月视图、分类、关于、通知、手动检查更新、浏览器备份提示、事项增删改、完成、拖放、日期时间、提醒、每日重复、子事项、分类增删、退出与重新登录均已验证。
- 视口验收：`1100 x 720`、`1360 x 900`、`1440 x 900` 均无页面级横纵溢出或不可点击区域；控制台 0 错误、0 警告，生产端 29 个请求均为本地资源。
- 原型验收：`prototypes/sui-time-reference/desktop/index.html` 与 `prototypes/sui-time-reference/dist/sui-time-reference.html` 均在独立 Playwright Chromium 中打开并完成视图切换；单 HTML 仅请求自身本地文件，控制台 0 错误、0 警告。
- 静态与构建验证：原型校验通过并导出 51,714 字节的单 HTML；`desktop-client` 生产构建、Rust 14 项测试、`cargo fmt --check` 和 `git diff --check` 均通过。
- 环境边界：真实更新资产下载、签名校验、安装和重启未在浏览器中伪造，继续由 Tauri 安装包或 CI/Release 环境验证。

## 决策记录

- 2026-08-15：采用“原型优先融合”，吸收深色山景侧栏、蓝色强调和紧凑信息布局，但生产功能和数据契约优先于原型表现。
- 2026-08-15：根 `README.md` 作为唯一中文文档，删除重复的 `README.zh-CN.md`。
- 2026-08-15：不引入新 UI 框架、状态库、远程资源或移动端实现。
- 2026-08-16：生产端与原型双形态验收完成，状态更新为 `implemented`；真实更新安装仍保留发布环境验证边界。
