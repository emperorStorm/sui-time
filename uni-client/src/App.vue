<template>
  <slot />
</template>

<style>
page,
body {
  --ink: #26282d;
  --muted: #969ba5;
  --line: #f0f1f4;
  --canvas: #f5f6f8;
  --panel: #ffffff;
  --blue: #2996f6;
  --blue-soft: #dceeff;
  --green: #10bf75;
  --orange: #ff8445;
  --danger: #f06368;
  --radius: 28rpx;
  --shadow: 0 8rpx 28rpx rgba(30, 44, 61, 0.07);
}

page {
  min-height: 100%;
  background: var(--canvas);
  color: var(--ink);
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 30rpx;
}

.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding-bottom: calc(180rpx + env(safe-area-inset-bottom));
  background: var(--canvas);
}

.shell {
  width: 100%;
  max-width: 900rpx;
  margin: 0 auto;
}

.panel {
  background: var(--panel);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.muted {
  color: var(--muted);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 104rpx;
  padding: 0 20rpx calc(8rpx + env(safe-area-inset-top));
  background: var(--panel);
  border-bottom: 2rpx solid var(--line);
}

.topbar .topbar-title {
  font-size: 34rpx;
  font-weight: 600;
}

.topbar .topbar-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  color: #5c6167;
  font-size: 36rpx;
}

.topbar .topbar-action:active {
  background: #eef2f6;
}

/* H5 下 uni-modal 需高于底部弹层（sheet-layer z-index 1000）与原生 tabBar */
uni-modal,
.uni-modal,
uni-modal .uni-modal__mask,
uni-modal .uni-modal__content {
  z-index: 2000 !important;
}
</style>
