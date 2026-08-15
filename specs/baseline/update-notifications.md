---
id: baseline-update-notifications
title: 更新与通知中心基线
status: implemented
updated: 2026-08-14
---

# 更新与通知中心基线

## 目标与范围

桌面客户端自动或手动检查 Tauri 更新，把新版本保存为应用内通知，展示更新内容、下载进度、失败重试和已安装状态，并在安装后重启应用。

## 业务规则

- 自动检查失败不阻止进入工作区；手动检查向用户展示错误。
- 同一时刻共享一个 `updateCheckPromise`，避免自动和手动重复请求。
- 通知 ID 为 `app-update:<version>`，同版本更新而不重复新增。
- 通知、已读和安装状态保存在 `localStorage` 的 `sui-time:notifications`。
- 更新说明优先读取 GitHub compare 提交记录，失败时回退更新包 release notes。
- Markdown 经 `marked` 转换并使用 DOMPurify 清理后渲染。
- 下载和安装使用 Tauri updater；安装中禁止关闭弹层，完成后调用 relaunch。

## 接口与数据

- 组件：`desktop-client/src/components/AppNotificationCenter.vue`。
- API：`checkAppUpdate`、`getUpdateCommits`、`installAppUpdate`、`formatUpdateError`。
- 对外暴露：`defineExpose({ checkForUpdate })`，About 页复用同一检查入口。
- Release 和 OSS 资产由 `.github/workflows/release.yml` 生成和同步，本地代码不能证明远端发布完成。

## 验收与证据

- 浏览器模式只验证通知 UI 和无更新分支；真实下载、签名、安装、重启必须在 Tauri 安装包或 CI/Release 中验证。
- 前端构建覆盖类型和模板，人工验收覆盖去重、已读、进度、失败重试和已安装状态。
