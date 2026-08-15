# Sui-Time AI Coding 入口

本文件是 Codex 在本仓库工作的唯一规则入口。所有回答、计划、代码注释和项目文档默认使用简体中文。

## 项目事实

- 当前产品是本地优先的桌面待办与时间规划应用。
- 前端为 Vue 3.5、TypeScript、Vite；原生层为 Tauri 2、Rust、SQLite。
- 账号、会话、分类和事项保存在操作系统应用数据目录的 `sui-time.sqlite3`。
- 当前运行时不依赖业务服务器。移动端、云同步、PostgreSQL 和 OSS 同步属于规划，不是已实现能力。
- 包管理器使用 npm，保留两个目录中的 `package-lock.json`。

## 开始任务前

1. 先检查 `git status --short`，保留用户已有和未提交改动。
2. 按任务读取 `rules/README.md` 中对应规则，不必无差别加载全部文档。
3. 涉及现有功能时，读取 `specs/README.md` 和对应基线 Spec，并以真实代码、数据库和测试为最终事实。
4. 新需求先建立或更新 `specs/changes/<功能名>/spec.md`，再实施代码。

## 强制要求

- 不新增无关逻辑，不顺手重构任务范围之外的代码。
- 保持数据请求、业务逻辑和结果展示分层；非复用逻辑不做无意义封装，函数控制在 200 行以内。
- 做好空值、格式、所有权和异常边界校验，避免重复计算和不必要对象创建。
- 定时器、监听器、数据库连接、浏览器和临时服务必须按生命周期释放。
- 修改共享状态、异步流程或 Rust 事务时检查并发、重复执行和线程安全风险。
- 完成声明必须基于本轮实际运行的验证结果。

## 常用命令

```bash
cd desktop-client && npm run build
cd tauri-desktop/src-tauri && cargo test
cd tauri-desktop/src-tauri && cargo fmt --check
git diff --check
```

仅需要静态原型时直接打开 HTML，不启动服务。确需运行开发服务时，在对话结束前关闭，除非用户明确要求保留。

## 浏览器调试隔离

- 网页开发、测试和原型验收只使用独立 Playwright Chromium。
- 每次创建独立临时用户数据目录，禁止连接或复用用户 Chrome、现有标签页、扩展、登录态和用户数据目录。
- 调试结束后关闭 Chromium，并清理本次临时目录。
