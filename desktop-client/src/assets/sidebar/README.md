# 侧栏背景资源

默认侧栏只使用 CSS 基底，不加载图片。

需要启用背景图时，将资源放在此目录，并在 `app.css` 对应的侧栏皮肤中设置：

```css
--sidebar-background-image: url("../assets/sidebar/your-background.webp");
--sidebar-background-opacity: .12;
--sidebar-background-position: center bottom;
--sidebar-background-size: cover;
```

背景图必须保持低对比度，避免影响菜单文字和图标阅读。
