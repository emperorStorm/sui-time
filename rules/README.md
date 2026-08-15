# 项目规则索引

按任务读取相关规则：

| 任务 | 必读规则 | 相关 Spec |
| --- | --- | --- |
| 项目结构、模块归属、依赖调整 | `01-project-architecture.md` | `specs/README.md` |
| Vue 页面、组件、状态、样式 | `02-frontend.md` | 对应功能 Spec |
| Tauri command、Rust、SQLite、备份 | `03-native-data.md` | 对应功能 Spec |
| 新建或修改交互原型 | `04-prototype.md` | 原型关联 Spec |
| 构建、测试、浏览器验收 | `05-verification.md` | Spec 验收条件 |

规则描述长期稳定的工程约束，Spec 描述具体功能和验收标准。规则与真实代码冲突时先核对当前实现；如果规则已过期，应在同一任务中更新规则，不得假装代码符合旧文档。
