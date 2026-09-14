<template>
  <slot />
</template>

<style>
page,
body {
  --ink: #26282d;
  --muted: #969ba5;
  --line: #eceef2;
  --canvas: #f7f8fa;
  --panel: #ffffff;
  --blue: #2996f6;
  --blue-soft: #dceeff;
  --green: #10bf75;
  --orange: #ff8445;
  --danger: #f06368;
  --radius: 24rpx;
  --shadow: 0 16rpx 36rpx rgba(30, 44, 61, 0.1);
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
</style>
