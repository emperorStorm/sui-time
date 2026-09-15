<template>
  <view class="page placeholder-page">
    <view class="topbar">
      <view class="topbar-title">目标</view>
    </view>
    <view class="placeholder-body">
      <view class="placeholder-icon">🎯</view>
      <text class="placeholder-text">目标功能敬请期待</text>
    </view>
  </view>
</template>

<script setup>
</script>

<style scoped>
.placeholder-page {
  min-height: 100vh;
  background: var(--canvas);
}

.placeholder-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 240rpx;
  gap: 32rpx;
}

.placeholder-icon {
  font-size: 96rpx;
}

.placeholder-text {
  color: var(--muted);
  font-size: 30rpx;
}
</style>
