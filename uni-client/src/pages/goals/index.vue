<template>
  <view class="page placeholder-page">
    <view class="topbar"><view class="topbar-title">目标</view></view>
    <view class="placeholder-body">
      <view class="placeholder-card">
        <view class="placeholder-icon"><image src="/static/tabbar/goals-active.png" mode="aspectFit" aria-hidden="true" /></view>
        <text class="placeholder-badge">敬请期待</text>
        <text class="placeholder-title">目标功能尚未开放</text>
        <text class="placeholder-description">把想抵达的方向，交给每一步的积累。</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { useMainTabTap } from '../../utils/main-tab.js'
useMainTabTap('pages/goals/index', () => {})
</script>
