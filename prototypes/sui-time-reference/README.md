# 岁岁时光多端交互原型

本目录是岁岁时光的需求与交互参考，不是生产客户端。当前只实现桌面端；移动端保留目录和数据语义说明，不代表移动应用已经存在。

## 入口与交付物

| 类型 | 路径 | 状态 |
| --- | --- | --- |
| 可维护源码 | `desktop/index.html` | 已实现，可直接用浏览器打开 |
| 单文件评审稿 | `dist/sui-time-reference.html` | 由统一脚本生成，可独立打开 |
| 移动端 | `mobile/README.md` | 仅预留，未实现 |
| 共享数据 | `shared/data.js` | 原型模拟数据 |
| 设计变量与素材 | `shared/tokens.css`、`shared/assets/` | 本地资源 |

原型不依赖服务、CDN、远程字体或用户登录态。

## 页面与弹层清单

| 类型 | 名称 | 入口/动作 | 主要状态 |
| --- | --- | --- | --- |
| 主视图 | 事项列表 | 左侧“全部” | 分类列、搜索、隐藏完成、空列 |
| 主视图 | 我的一周 | 左侧“我的一周” | 上下周、日期新增、日程项 |
| 主视图 | 我的一月 | 左侧“我的一月” | 上下月、月历事项、溢出数量 |
| 主视图 | 个人资料 | 头像或账号菜单 | 编辑昵称、性别、签名、保存 |
| 弹层 | 事项编辑 | 悬浮新增或事项卡片 | 新增、编辑、删除、校验失败 |
| 二级弹层 | 日期与时间 | 事项弹层“日期与时间” | 时间点、时间段、全天、清除 |
| 二级弹层 | 重复规则 | 事项弹层“重复” | 不重复、日/周/月/年、记忆曲线 |
| 弹层 | 基础设置 | 齿轮或账号菜单 | 主题、紧凑导航、仅显示本周、恢复数据 |

## 关键流程

1. 在事项列表、周视图或月视图打开新增弹层，填写标题并保存。
2. 打开事项，修改优先级、分类、日期时间、重复规则、子任务和备注。
3. 完成或重新打开事项；删除已有事项；空标题保存时显示校验提示。
4. 在周/月视图切换时间范围并从具体日期新增事项。
5. 修改个人资料或设置后刷新页面，确认本地数据继续存在。
6. 点击“恢复演示数据”，回到初始模拟数据。

## 状态矩阵

| 状态 | 表现 |
| --- | --- |
| 默认 | 使用 `shared/data.js` 的固定账号、分类、事项和设置 |
| 空列 | 分类下没有匹配事项时显示“暂时没有事项” |
| 校验失败 | 事项标题为空时使用浏览器提示，不写入数据 |
| 成功 | 新增、编辑、删除、完成、资料和设置立即更新界面并持久化 |
| 取消 | 点击遮罩或取消按钮关闭弹层，不保存草稿 |
| 持久化 | 写入 `localStorage` 的 `sui-time-reference:v1` |
| 恢复 | 恢复初始数据并关闭当前菜单或弹层 |
| 加载/网络错误 | 本原型没有网络请求，因此不模拟网络加载与失败 |

## 模拟数据契约

原型使用轻量展示字段，不直接作为生产接口：

| 原型字段 | 生产语义 |
| --- | --- |
| `tags[]`、`tagId` | `Category[]`、`categoryId` |
| `date`、`time` | `plannedDate`、`plannedTime` |
| `schedule` | `scheduleKind`，原型值使用 `allDay/point/range` |
| `repeat` | `repeatRule.kind` 的简化值 |
| `subtasks[]` | 生产中的 `parentTaskId` 子事项集合 |

模拟数据不包含真实账号、令牌或用户隐私。生产契约以 `desktop-client/src/types.ts`、Rust model 和基线 Spec 为准。

## Spec 对应

- 事项与规划：`specs/baseline/tasks-planning.md`
- 分类：`specs/baseline/categories.md`
- 重复实例：`specs/baseline/recurrence-occurrences.md`
- 当前原型没有覆盖账号登录、系统提醒、逾期自动顺延、加密备份和真实更新安装。

## 校验与导出

```bash
python3 /Users/wangjun/.codex/skills/build-interactive-prototype/scripts/validate_prototype.py prototypes/sui-time-reference
python3 /Users/wangjun/.codex/skills/build-interactive-prototype/scripts/export_single_html.py prototypes/sui-time-reference
```

浏览器验收必须分别打开 `desktop/index.html` 和 `dist/sui-time-reference.html`，使用独立 Playwright Chromium 与临时用户数据目录。完成后关闭浏览器并清理临时目录。
