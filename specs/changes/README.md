# 变更 Spec

每项新需求建立 `specs/changes/<kebab-case 功能名>/spec.md`，从 `specs/_template/spec.md` 复制结构。目录内只放与该需求直接相关的原始资料、原型截图或迁移脚本，避免把通用规则复制进来。

功能完成后：

1. 将状态改为 `implemented`。
2. 填写真实代码路径和验证结果。
3. 同步受影响的 `specs/baseline/` 文件。
4. 被替代的 Spec 改为 `superseded` 并链接新文件。
