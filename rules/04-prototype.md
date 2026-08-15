# 交互原型规则

## 默认工具与产物

- 新建或重构原型时使用全局 `$build-interactive-prototype` Skill。
- 默认同时维护多文件源码和 `dist/*.html` 单文件交付物。
- 原型根目录必须包含 `prototype.config.json`，入口保留 `prototype:styles` 和 `prototype:scripts` 标记。
- 所有 CSS、JavaScript、字体、图标、图片和媒体必须本地化，禁止 CDN、远程字体和热链。

## Sui-Time 原型

- 当前真实样例位于 `prototypes/sui-time-reference/`。
- `desktop/` 是已实现桌面原型；`mobile/` 只是预留入口，不得描述为可用移动端。
- `shared/data.js` 保存模拟数据，`shared/tokens.css` 保存设计变量。
- 浏览器持久化键为 `sui-time-reference:v1`，README 必须说明恢复默认数据方式。
- 原型模拟字段尽量与 `specs/baseline/` 和 `desktop-client/src/types.ts` 对齐；原型专用字段需明确标注。

## 设计与交互

- README 维护页面清单、主流程、状态矩阵、数据契约、Spec 映射和未实现范围。
- 使用稳定 `data-action` 事件钩子和事件委托，不新增内联 `onclick`。
- 新增功能至少覆盖默认、空值/校验失败、成功反馈和取消路径；破坏性操作需要确认。
- 原型用于验证需求和交互，不得反向覆盖真实业务规则。两者冲突时先更新 Spec 并明确决策。
