# 验证规则

## 代码验证矩阵

| 变更范围 | 最低验证 |
| --- | --- |
| Vue、TypeScript、样式 | `cd desktop-client && npm run build` |
| Rust、command、SQLite | `cd tauri-desktop/src-tauri && cargo test`、`cargo fmt --check` |
| 原型源码 | Skill 的 `validate_prototype.py`、单 HTML 导出、Playwright 主流程 |
| 任意仓库文件 | `git diff --check`、复核 `git status --short` |
| 发版配置 | 本地配置生成检查 + 对应 CI/Release 真实状态，不用本地构建代替远端结论 |

测试、构建和格式检查证明的范围不同，不得互相替代。完成结论必须引用本轮命令、退出状态和关键结果。

## 浏览器验收

- 使用独立 Playwright Chromium 和独立临时用户数据目录。
- 禁止连接用户现有 Chrome、标签页、扩展、登录态和用户目录。
- 源码入口和导出 HTML 分别打开，至少验证主视图切换、核心增删改、本地持久化和恢复默认数据。
- 检查控制台异常、失败请求、空白区域、文字溢出、弹层越界、控件重叠和布局跳动。
- 结束后关闭浏览器、删除临时目录；如果启动临时服务也要关闭。

## 工作区保护

- 验证前后都检查工作区，只处理本任务产生的文件。
- 格式化工具产生无关 diff 时立即收窄，不覆盖用户已有修改。
- 当前仓库存在未提交改动时，报告中区分既有改动与本次新增内容。
