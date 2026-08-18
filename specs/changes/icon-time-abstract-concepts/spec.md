---
title: 时光抽象图标概念提案
status: implemented
owner: product-design
updated: 2026-08-18
---

# 时光抽象图标概念提案

## 目标

为 Sui-Time 提供 5 个以“时光、抽象”为核心的应用图标方向，并将选定的“01 年轮刻度”同步为正式品牌图标和全平台应用图标。

## 设计约束

- 图形不依赖文字，在桌面 Dock、安装包和应用内品牌位均可独立识别。
- 避免再次使用具象沙漏，以刻度、折叠、日晷、潮汐和时隙表达时间。
- 主体保持在图标安全区内，关键结构在 64px 预览下仍可辨认。
- 每个方向使用独立色彩性格，但保留温和、专注、陪伴式时间管理的产品气质。
- 源文件使用 1024×1024 SVG，便于选定后继续调整并生成 Tauri 全平台图标。

## 概念方向

| 编号 | 名称 | 时间隐喻 | 气质 |
| --- | --- | --- | --- |
| 01 | 年轮刻度 | 时间沉积为层层年轮，缺口形成前进节奏 | 安静、自然、长期主义 |
| 02 | 折叠一刻 | 时间带折叠并在中心交汇，形成抽象的 S | 灵动、现代、品牌感 |
| 03 | 晷影之窗 | 光点与投影构成日晷，表现当下时刻 | 克制、理性、编辑感 |
| 04 | 潮汐日历 | 周期波形承载一枚日点，表达日复一日 | 温柔、流动、陪伴感 |
| 05 | 时隙之门 | 多层时间切片围成开放入口 | 深邃、专注、未来感 |

## 选定方案

- 2026-08-18：选定 `01 年轮刻度` 作为正式方向。
- 保留绿色年轮与金色时刻点，以时间沉积和持续前进表达本地时间规划产品。
- 正式 SVG 复用 1024×1024 矢量源，通过 Tauri CLI 生成桌面端和现有移动端图标资产。

## 交付物

- `docs/brand/time-abstract-2026/time-abstract-01-rings.svg`
- `docs/brand/time-abstract-2026/time-abstract-02-fold.svg`
- `docs/brand/time-abstract-2026/time-abstract-03-sundial.svg`
- `docs/brand/time-abstract-2026/time-abstract-04-tide.svg`
- `docs/brand/time-abstract-2026/time-abstract-05-aperture.svg`
- `docs/brand/time-abstract-2026/time-abstract-overview.svg`
- `docs/brand/time-abstract-2026/time-abstract-overview.png`

## 验收条件

- 总览图同时展示 5 个方向，并包含名称、核心关键词和小尺寸预览。
- 5 个独立 SVG 均可正常解析，画布和视图框为 1024×1024。
- 总览 PNG 可正常渲染，且没有图形截断、文字溢出或元素重叠。
- 前端品牌位、Windows、macOS、Android 和 iOS 现有图标资产使用同一“年轮刻度”源文件生成。

## 本轮验证记录

- 2026-08-18：6 个 SVG 均通过 `xmllint --noout` 解析检查。
- 2026-08-18：使用独立 Playwright Chromium 在 2200×1080 视口渲染总览，5 个相对 SVG 资源均返回 200；仅缺少非必需的 `favicon.ico`。
- 2026-08-18：人工检查总览截图，无图形截断、文字溢出和卡片重叠，64px 预览均可识别。
- 2026-08-18：用户选定“01 年轮刻度”，已同步 `desktop-client/src/assets/brand/sui-time-icon.svg` 并通过 Tauri CLI 重建全平台图标资产。
