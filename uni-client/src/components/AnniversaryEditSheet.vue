<template>
  <view v-if="visible" class="anniversary-sheet-mask" @click="close">
    <view class="anniversary-sheet" @click.stop>
      <view class="sheet-heading"><button @click="close" :disabled="saving || importing">取消</button><text>{{ draft.id ? '编辑纪念日' : '新增纪念日' }}</text><button class="sheet-save" :disabled="saving || importing" @click="submit">{{ saving ? '保存中' : '保存' }}</button></view>
      <scroll-view class="sheet-scroll" scroll-y>
        <view class="sheet-types"><button v-for="type in anniversaryTypes" :key="type.value" :class="{ active: draft.kind === type.value }" @click="draft.kind = type.value"><text class="type-mark">{{ type.mark }}</text>{{ type.label }}</button></view>
        <view class="sheet-field"><text>名称</text><input v-model="draft.title" maxlength="120" placeholder="例如：我们的相伴纪念日" /></view>
        <view class="sheet-field"><text>{{ draft.kind === 'birthday' ? '出生日期（公历）' : '原始日期（公历）' }}</text><picker mode="date" :value="draft.date" start="1900-01-01" :end="draft.kind === 'birthday' ? localToday() : '2100-12-31'" @change="draft.date = $event.detail.value"><view class="date-value">{{ draft.date }} <text>›</text></view></picker></view>
        <text class="sheet-hint">{{ draft.kind === 'countdown' ? '按固定日期计数，不自动重复。' : '按公历月日每年纪念，农历仅用于展示。' }}</text>
        <view class="sheet-field"><text>备注</text><textarea v-model="draft.notes" maxlength="2000" placeholder="留下一段值得珍藏的回忆" /></view>
        <view class="sheet-field"><text>背景</text><view class="sheet-themes"><button v-for="theme in anniversaryThemes" :key="theme.value" :class="[`anniversary-theme-${theme.value}`, { active: draft.theme === theme.value }]" @click="draft.theme = theme.value">{{ theme.label }}</button></view></view>
        <view class="sheet-field"><text>照片 · 最多 4 张，点击照片可更换</text><view class="sheet-photos"><view v-for="(photo, index) in draft.photos" :key="index" class="draft-photo"><image :src="photo" mode="aspectFill" @click="importPhoto(index)" /><button :class="{ active: draft.coverIndex === index }" @click="draft.coverIndex = index">{{ draft.coverIndex === index ? '封面' : '设为封面' }}</button><button class="photo-remove" :disabled="importing" @click="removePhoto(index)">×</button></view><button v-if="draft.photos.length < 4" class="photo-add" :disabled="importing" @click="importPhoto()">{{ importing ? '处理中' : '＋ 添加照片' }}</button></view></view>
        <view class="sheet-pin"><text>置顶这条纪念日</text><switch :checked="draft.pinned" color="#2996f6" @change="draft.pinned = $event.detail.value" /></view>
        <text v-if="error" class="sheet-error">{{ error }}</text>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { anniversaryThemes, anniversaryTypes, chooseAnniversaryPhoto, localToday } from '../utils/anniversary'
import { saveAnniversary } from '../api/store'

const props = defineProps({ visible: Boolean, item: { type: Object, default: null } })
const emit = defineEmits(['close', 'saved'])
const draft = reactive({ id: undefined, kind: 'anniversary', title: '', date: localToday(), notes: '', pinned: false, theme: 'sky', photos: [], coverIndex: 0 })
const saving = ref(false)
const importing = ref(false)
const error = ref('')
watch(() => props.visible, visible => {
  if (!visible) return
  const item = props.item
  Object.assign(draft, { id: item?.id, kind: item?.kind || 'anniversary', title: item?.title || '', date: item?.date || localToday(), notes: item?.notes || '', pinned: item?.pinned || false, theme: item?.theme || 'sky', photos: [...(item?.photos || [])], coverIndex: item?.coverIndex || 0 })
  error.value = ''
}, { immediate: true })

function close() { if (!saving.value && !importing.value) emit('close') }
function submit() {
  if (saving.value || importing.value) return
  saving.value = true
  error.value = ''
  try { const item = saveAnniversary({ ...draft, photos: [...draft.photos] }); emit('saved', item) }
  catch (cause) { error.value = cause.message || String(cause) }
  finally { saving.value = false }
}

async function importPhoto(index) {
  if (importing.value) return
  importing.value = true
  error.value = ''
  try {
    const photo = await chooseAnniversaryPhoto()
    if (!props.visible) return
    if (index !== undefined) draft.photos[index] = photo
    else if (draft.photos.length < 4) draft.photos.push(photo)
  } catch (cause) {
    if (!String(cause.errMsg || '').includes('cancel')) error.value = cause.message || cause.errMsg || '无法导入照片，请重试'
  } finally { importing.value = false }
}
function removePhoto(index) { if (importing.value) return; draft.photos.splice(index, 1); if (draft.coverIndex === index) draft.coverIndex = 0; else if (draft.coverIndex > index) draft.coverIndex-- }
defineExpose({ close })
</script>

<style scoped>
.anniversary-sheet-mask { position: fixed; inset: 0; z-index: 1000; background: #16223470; display: flex; align-items: flex-end; }
.anniversary-sheet { width: 100%; max-width: 900rpx; margin: 0 auto; background: #fff; border-radius: 36rpx 36rpx 0 0; overflow: hidden; padding-bottom: env(safe-area-inset-bottom); }
.sheet-heading { display: flex; height: 112rpx; align-items: center; justify-content: space-between; padding: 0 24rpx; border-bottom: 2rpx solid #f0f1f4; }.sheet-heading > text { font-size: 32rpx; font-weight: 600; }.sheet-heading button { background: transparent; border: 0; font-size: 28rpx; padding: 0 10rpx; color: #9099a7; margin: 0; }.sheet-heading .sheet-save { color: #2996f6; }.sheet-heading button::after, .sheet-types button::after, .sheet-themes button::after, .sheet-photos button::after { border: 0; }
.sheet-scroll { max-height: 72vh; }.sheet-types { display: flex; gap: 12rpx; margin: 28rpx; }.sheet-types button { flex: 1; background: #f3f5f8; font-size: 24rpx; line-height: 1.5; padding: 16rpx 4rpx; color: #8993a2; margin: 0; border-radius: 16rpx; }.sheet-types .type-mark { display: block; font-size: 42rpx; margin-bottom: 8rpx; }.sheet-types .active { background: #e6f2ff; color: #2996f6; box-shadow: inset 0 0 0 2rpx #8fc4f3; }
.sheet-field { margin: 24rpx 28rpx; }.sheet-field > text { display: block; font-size: 25rpx; color: #798594; margin-bottom: 16rpx; }.sheet-field input, .date-value, .sheet-field textarea { background: #f5f7fa; padding: 22rpx; border-radius: 14rpx; font-size: 28rpx; }.sheet-field input { height: 48rpx; }.date-value { display: flex; justify-content: space-between; }.date-value text { color: #adb5c0; }.sheet-field textarea { width: 100%; box-sizing: border-box; height: 160rpx; }.sheet-hint { display: block; margin: -10rpx 28rpx 24rpx; color: #9ba5b3; font-size: 22rpx; line-height: 1.7; }
.sheet-themes { display: flex; gap: 16rpx; }.sheet-themes button { flex: 1; margin: 0; font-size: 24rpx; line-height: 80rpx; }.sheet-themes .active { outline: 3rpx solid #65aceb; outline-offset: 3rpx; }.anniversary-theme-sky { background: linear-gradient(140deg, #e6f0fc, #d4e8f0); color: #395b7e; }.anniversary-theme-warm { background: linear-gradient(140deg, #fff0df, #f7dee3); color: #8c5b58; }.anniversary-theme-night { background: linear-gradient(140deg, #273951, #192636); color: #e1eaf6; }
.sheet-photos { display: flex; gap: 16rpx; flex-wrap: wrap; }.draft-photo { position: relative; width: 144rpx; }.draft-photo image { width: 144rpx; height: 128rpx; border-radius: 12rpx; }.draft-photo > button { margin: 0; background: transparent; font-size: 22rpx; line-height: 52rpx; padding: 0; color: #9aa3b0; }.draft-photo > button.active { color: #2996f6; }.draft-photo > .photo-remove { position: absolute; top: 4rpx; right: 4rpx; width: 36rpx; line-height: 36rpx; border-radius: 50%; background: #0008; color: #fff; font-size: 30rpx; }.photo-add { margin: 0; width: 144rpx; height: 128rpx; display: flex; align-items: center; justify-content: center; background: #f4f7fa; color: #91a0b0; font-size: 22rpx; padding: 0; border: 2rpx dashed #d6dfeb; }
.sheet-pin { margin: 30rpx 28rpx; display: flex; justify-content: space-between; align-items: center; font-size: 27rpx; color: #737f8d; }.sheet-error { display: block; padding: 0 28rpx 30rpx; color: #dd656f; font-size: 25rpx; line-height: 1.7; }
</style>
