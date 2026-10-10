<template>
  <section class="page anniversary-page">
    <div class="anniversary-toolbar"><label class="search-box"><Search :size="18" /><input v-model="search" placeholder="搜索纪念日或备注" aria-label="搜索纪念日或备注" /></label><button class="primary-button" @click="openEditor()"><Plus :size="17" />新增纪念日</button></div>
    <div class="anniversary-filters"><button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部 · {{ items.length }}</button><button v-for="type in anniversaryTypes" :key="type.value" :class="{ active: filter === type.value }" @click="filter = type.value">{{ type.label }}</button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button class="quiet-button" @click="refresh()">重试</button></p>
    <p v-if="loading" class="empty-state">正在读取纪念日…</p>
    <div v-else class="anniversary-layout">
      <div class="anniversary-list"><p v-if="!visibleItems.length" class="empty-state">{{ items.length ? '没有符合条件的纪念日' : '记录一个值得记住的日子，从今天开始。' }}</p><button v-for="item in visibleItems" :key="item.id" :class="['anniversary-row', { selected: selected?.id === item.id }]" @click="selectItem(item.id)"><span :class="['anniversary-mark', `kind-${item.kind}`]">{{ typeMeta.get(item.kind)?.mark }}</span><span class="row-copy"><strong>{{ item.title }} <Pin v-if="item.pinned" :size="12" /></strong><small>{{ item.state.nextDate }} · {{ typeMeta.get(item.kind)?.label }}<template v-if="item.kind === 'birthday'"> · {{ item.state.nextAge }}岁</template></small></span><span class="row-days"><small>{{ item.state.label }}</small><strong v-if="item.state.days">{{ item.state.days }}<small>天</small></strong></span></button></div>
      <section v-if="selected && state && calendar" class="anniversary-detail">
        <header class="detail-actions"><span>{{ typeMeta.get(selected.kind)?.label }}</span><div><button class="icon-button ghost" :title="selected.pinned ? '取消置顶' : '置顶'" :disabled="busy" @click="togglePin"><Pin :size="17" :fill="selected.pinned ? 'currentColor' : 'none'" /></button><button class="icon-button ghost" title="编辑纪念日" :disabled="busy" @click="openEditor(selected)"><Pencil :size="17" /></button><button class="icon-button ghost danger" title="删除纪念日" :disabled="busy" @click="removeSelected"><Trash2 :size="17" /></button></div></header>
        <div :class="['anniversary-hero', `theme-${selected.theme}`]"><span>{{ selected.kind === 'anniversary' && selected.date <= today ? '已经相伴' : state.label }}</span><div class="hero-number">{{ selected.kind === 'anniversary' && selected.date <= today ? state.elapsedDays : state.days }}<small>天</small></div><p v-if="selected.kind === 'anniversary' && selected.date <= today">{{ state.elapsedText }}</p><h2>{{ selected.title }}</h2><p>{{ selected.date }} {{ originalCalendar?.weekday }} · 农历{{ originalCalendar?.lunar }}</p></div>
<div class="detail-body"><div v-if="selected.kind !== 'countdown'" class="anniversary-next"><span>下一{{ selected.kind === 'birthday' ? '生日' : selected.kind === 'holiday' ? '节日' : '周年' }}</span><strong>{{ state.nextDate }} {{ calendar.weekday }}</strong><span>农历{{ calendar.lunar }} · {{ state.label }}<template v-if="state.days"> {{ state.days }} 天</template></span></div><p v-if="state.adjusted" class="anniversary-hint">下次纪念年份没有 2 月 29 日，按 2 月末纪念。</p><div v-if="selected.kind === 'birthday'" class="birthday-info"><div><strong>{{ state.age }}岁</strong><span>当前周岁 · 下次满{{ state.nextAge }}岁</span></div><div><strong>属{{ originalCalendar?.zodiac }}</strong><span>生肖</span></div><div><strong>{{ originalCalendar?.star }}</strong><span>星座</span></div></div><p v-if="selected.notes" class="anniversary-notes">{{ selected.notes }}</p><div v-if="selected.photos.length" class="anniversary-gallery"><button v-for="(photo, index) in selected.photos" :key="index" :class="{ cover: index === selected.coverIndex }" :aria-label="`查看照片 ${index + 1}`" @click="preview = photo"><img :src="photo" alt="纪念日照片" /><span v-if="index === selected.coverIndex">封面</span></button></div><p v-if="!selected.notes && !selected.photos.length" class="anniversary-hint">可以添加一段回忆，或留几张照片。</p></div>
        <section class="anniversary-history"><h3>纪念记录</h3><p v-if="!history.length" class="anniversary-hint">在“我的一月”中记录每一次纪念，回忆会留在这里。</p><button v-for="record in history" :key="record.date" class="history-row" @click="activeRecord = anniversaryRecordOccurrence(record, selected.notes)"><span><strong>{{ record.date }} · {{ record.title }}</strong><small>{{ record.notes || '未填写本次备注' }}</small></span><small>{{ record.confirmedAt ? '✓ 已纪念' : '已备注' }}</small></button></section>
      </section>
      <div v-else class="anniversary-detail empty-detail"><span>♡</span><h2>把值得记住的日子留在这里</h2><p>选择左侧记录，查看它的时光故事。</p></div>
    </div>
    <Teleport to="body">
      <div v-if="editing" class="modal-backdrop" @mousedown.self="closeEditor"><form class="modal-panel anniversary-modal" role="dialog" aria-modal="true" :aria-label="draft.id ? '编辑纪念日' : '新增纪念日'" @submit.prevent="saveDraft">
        <header><h2>{{ draft.id ? '编辑纪念日' : '新增纪念日' }}</h2><button class="icon-button ghost" type="button" title="关闭" :disabled="saving || importing" @click="closeEditor"><X :size="20" /></button></header>
        <div class="type-picker"><button v-for="type in anniversaryTypes" :key="type.value" :class="{ active: draft.kind === type.value }" type="button" @click="draft.kind = type.value"><span>{{ type.mark }}</span>{{ type.label }}</button></div>
        <label class="field"><span>名称</span><input ref="titleInput" v-model="draft.title" maxlength="120" placeholder="例如：我们的相伴纪念日" /></label><div class="field"><span>{{ draft.kind === 'birthday' ? '出生日期（公历）' : '原始日期（公历）' }}</span><AnniversaryDatePicker v-model="draft.date" min="1900-01-01" :max="draft.kind === 'birthday' ? today : '2100-12-31'" :label="draft.kind === 'birthday' ? '选择出生日期' : '选择原始日期'" /></div><p class="anniversary-hint">{{ draft.kind === 'countdown' ? '按固定日期计数，不自动重复。' : '按公历月日每年纪念，农历仅用于展示。' }}</p>
        <label class="field"><span>备注</span><textarea v-model="draft.notes" maxlength="2000" placeholder="写下一段值得珍藏的回忆" /></label><div class="field"><span>背景</span><div class="theme-picker"><button v-for="theme in anniversaryThemes" :key="theme.value" :class="[`theme-${theme.value}`, { active: draft.theme === theme.value }]" type="button" @click="draft.theme = theme.value">{{ theme.label }}</button></div></div>
        <div class="field"><span>照片 <small>最多 4 张，可点击更换照片</small></span><div class="draft-photos"><div v-for="(photo, index) in draft.photos" :key="index"><button type="button" :aria-label="`更换照片 ${index + 1}`" :disabled="importing" @click="chooseFile(index)"><img :src="photo" alt="点击更换照片" /></button><button type="button" :class="{ active: draft.coverIndex === index }" @click="draft.coverIndex = index">{{ draft.coverIndex === index ? '封面' : '设为封面' }}</button><button class="remove-photo" type="button" :aria-label="`移除照片 ${index + 1}`" @click="removePhoto(index)"><X :size="13" /></button></div><button v-if="draft.photos.length < 4" class="add-photo" type="button" :disabled="importing" @click="chooseFile()"><Plus :size="22" />{{ importing ? '正在处理' : '添加照片' }}</button></div><input ref="fileInput" class="file-input" type="file" accept="image/jpeg,image/png,image/webp" @change="importPhoto" /></div>
        <label class="pin-checkbox"><input v-model="draft.pinned" type="checkbox" />置顶这条纪念日</label><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><footer><span></span><button class="quiet-button" type="button" :disabled="saving || importing" @click="closeEditor">取消</button><button class="primary-button" :disabled="saving || importing">{{ saving ? '正在保存' : '保存纪念日' }}</button></footer>
      </form></div>
      <div v-if="preview" class="modal-backdrop anniversary-preview" role="dialog" aria-modal="true" aria-label="照片预览" @click.self="preview = ''"><button class="icon-button" aria-label="关闭照片预览" @click="preview = ''"><X :size="24" /></button><img :src="preview" alt="纪念日照片预览" /></div>
    </Teleport>
    <AnniversaryRecordModal v-if="activeRecord" :occurrence="activeRecord" @close="activeRecord = null" @saved="recordSaved" @details="activeRecord = null" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Pencil, Pin, Plus, Search, Trash2, X } from 'lucide-vue-next'
import type { Anniversary, AnniversaryInput, AnniversarySummary, AnniversaryRecord, AnniversaryOccurrence } from '../types'
import { getAnniversary, listAnniversaries, pinAnniversary, removeAnniversary, saveAnniversary, listAnniversaryRecords } from '../api/native'
import AnniversaryDatePicker from './AnniversaryDatePicker.vue'
import AnniversaryRecordModal from './AnniversaryRecordModal.vue'
import { anniversaryRecordOccurrence } from '../../../shared/anniversary.mjs'
import { anniversaryCalendar, anniversaryState, anniversaryThemes, anniversaryTypes, compressAnniversaryPhoto, localToday, orderedAnniversaries } from '../utils/anniversary'

const props = defineProps<{ initialId?: string }>()
const history = ref<AnniversaryRecord[]>([])
const activeRecord = ref<AnniversaryOccurrence | null>(null)
const items = ref<AnniversarySummary[]>([])
const selected = ref<Anniversary | null>(null)
const search = ref('')
const filter = ref('all')
const today = ref(localToday())
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const editing = ref(false)
const saving = ref(false)
const importing = ref(false)
const formError = ref('')
const preview = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
const draft = reactive<AnniversaryInput>({ kind: 'anniversary', title: '', date: today.value, notes: '', theme: 'sky', pinned: false, photos: [], coverIndex: 0 })
const typeMeta = new Map(anniversaryTypes.map(item => [item.value, item]))
let selectionRequest = 0
let refreshRequest = 0
let photoIndex: number | undefined
let dayTimer: number | undefined
let disposed = false
const orderedItems = computed(() => orderedAnniversaries(items.value, today.value))
const visibleItems = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return orderedItems.value.filter(item => (filter.value === 'all' || item.kind === filter.value) && `${item.title} ${item.notes}`.toLowerCase().includes(keyword))
})
const state = computed(() => selected.value ? anniversaryState(selected.value, today.value) : null)
const calendar = computed(() => state.value ? anniversaryCalendar(state.value.nextDate) : null)
const originalCalendar = computed(() => selected.value ? anniversaryCalendar(selected.value.date) : null)

async function selectItem(id: string) {
  const request = ++selectionRequest
  selected.value = null
  history.value = []
  activeRecord.value = null
  try {
    const [item, records] = await Promise.all([getAnniversary(id), listAnniversaryRecords({ anniversaryId: id })])
    if (request === selectionRequest && !disposed) { selected.value = item; history.value = records }
  } catch (cause) { if (!disposed && request === selectionRequest) error.value = String(cause) }
}

async function refresh(preferredId = selected.value?.id) {
  const request = ++refreshRequest
  loading.value = true
  error.value = ''
  try {
    const result = await listAnniversaries()
    if (disposed || request !== refreshRequest) return
    items.value = result
    const next = visibleItems.value.find(item => item.id === preferredId) || visibleItems.value[0]
    if (next) await selectItem(next.id)
    else { selectionRequest++; selected.value = null }
  } catch (cause) { if (!disposed && request === refreshRequest) error.value = String(cause) }
  finally { if (!disposed && request === refreshRequest) loading.value = false }
}

async function openEditor(item?: Anniversary) {
  Object.assign(draft, { id: item?.id, kind: item?.kind || 'anniversary', title: item?.title || '', date: item?.date || today.value, notes: item?.notes || '', theme: item?.theme || 'sky', pinned: item?.pinned || false, photos: [...(item?.photos || [])], coverIndex: item?.coverIndex || 0 })
  formError.value = ''
  editing.value = true
  await nextTick()
  titleInput.value?.focus()
}
function closeEditor() { if (!saving.value && !importing.value) editing.value = false }

async function saveDraft() {
  if (saving.value || importing.value) return
  saving.value = true
  formError.value = ''
  try { const result = await saveAnniversary({ ...draft, photos: [...draft.photos] }); editing.value = false; filter.value = 'all'; search.value = ''; await refresh(result.id) }
  catch (cause) { formError.value = String(cause) }
  finally { saving.value = false }
}

async function togglePin() {
  if (!selected.value || busy.value) return
  const item = selected.value
  busy.value = true
  try { await pinAnniversary(item.id, !item.pinned); await refresh(item.id) }
  catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}

async function removeSelected() {
  if (!selected.value || busy.value || !window.confirm(`确定删除“${selected.value.title}”、照片及全部纪念记录吗？`)) return
  busy.value = true
  try { await removeAnniversary(selected.value.id); await refresh() }
  catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}

function chooseFile(index?: number) { photoIndex = index; fileInput.value?.click() }
async function importPhoto(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value) return
  const index = photoIndex
  importing.value = true
  formError.value = ''
  try { const result = await compressAnniversaryPhoto(file); if (!disposed) { if (index !== undefined) draft.photos[index] = result; else if (draft.photos.length < 4) draft.photos.push(result) } }
  catch (cause) { formError.value = String(cause) }
  finally { importing.value = false }
}
function removePhoto(index: number) { if (importing.value) return; draft.photos.splice(index, 1); if (draft.coverIndex === index) draft.coverIndex = 0; else if (draft.coverIndex > index) draft.coverIndex-- }

function refreshDay() {
  today.value = localToday()
  window.clearTimeout(dayTimer)
  const midnight = new Date()
  midnight.setHours(24, 0, 0, 0)
  dayTimer = window.setTimeout(refreshDay, midnight.getTime() - Date.now() + 100)
}
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') { if (preview.value) preview.value = ''; else closeEditor() } }
watch(visibleItems, list => { if (loading.value) return; if (!list.some(item => item.id === selected.value?.id)) { if (list[0]) void selectItem(list[0].id); else { selectionRequest++; selected.value = null } } })
function recordSaved(record: AnniversaryRecord) { history.value = [...history.value.filter(item => item.date !== record.date), record].sort((a, b) => b.date.localeCompare(a.date)) }
onMounted(() => { void refresh(props.initialId); refreshDay(); window.addEventListener('focus', refreshDay); document.addEventListener('visibilitychange', refreshDay); document.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => { disposed = true; selectionRequest++; refreshRequest++; window.clearTimeout(dayTimer); window.removeEventListener('focus', refreshDay); document.removeEventListener('visibilitychange', refreshDay); document.removeEventListener('keydown', onKeydown) })
</script>

<style scoped>
.anniversary-history { padding: 0 28px 28px; }.anniversary-history h3 { font-size: 15px; color: #61758e; margin-bottom: 12px; }.history-row { width: 100%; display: flex; gap: 14px; align-items: center; text-align: left; background: transparent; padding: 16px 0; border-bottom: 1px solid #edf0f4; color: #71859c; }.history-row > span { flex: 1; min-width: 0; display: grid; gap: 8px; }.history-row strong { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }.history-row small { font-size: 12px; color: #96a1ae; white-space: nowrap; }.history-row > span small { overflow: hidden; text-overflow: ellipsis; }
.anniversary-page { display: flex; flex-direction: column; gap: 18px; overflow-y: auto; padding: 28px 30px; }
.anniversary-toolbar { display: flex; justify-content: space-between; gap: 16px; }.anniversary-toolbar .search-box { width: min(380px, 60%); }
.anniversary-filters { display: flex; gap: 6px; flex-wrap: wrap; }.anniversary-filters button { background: transparent; padding: 7px 14px; border-radius: 6px; color: #7b8491; }.anniversary-filters .active { background: #e4effd; color: #247bdc; }
.anniversary-layout { display: grid; grid-template-columns: minmax(290px, .85fr) minmax(330px, 1.15fr); gap: 24px; align-items: start; }.anniversary-list, .anniversary-detail { background: #fff; border: 1px solid #e5e9ee; border-radius: 10px; overflow: hidden; }
.anniversary-row { display: flex; width: 100%; align-items: center; gap: 12px; padding: 22px 18px; background: #fff; text-align: left; border-bottom: 1px solid #edf0f4; }.anniversary-row:last-child { border-bottom: 0; }.anniversary-row:hover, .anniversary-row.selected { background: #f0f6ff; }
.anniversary-mark { display: grid; flex: 0 0 38px; height: 38px; place-items: center; color: #4d82d5; background: #eaf1fc; border-radius: 12px; font-size: 25px; }.kind-anniversary { color: #db7086; background: #fceef1; }.kind-birthday { color: #e68a42; background: #fff1e5; }.kind-holiday { color: #45a790; background: #e9f7f2; }
.row-copy { flex: 1; min-width: 0; display: grid; gap: 8px; }.row-copy strong { font-size: 14px; overflow-wrap: anywhere; }.row-copy small { font-size: 11px; color: #8a929e; line-height: 1.6; }.row-days { display: grid; text-align: right; white-space: nowrap; gap: 4px; }.row-days > small { color: #9099a7; font-size: 11px; }.row-days strong { font-size: 26px; font-weight: 500; font-variant-numeric: tabular-nums; color: #3f536c; }.row-days strong small { font-size: 11px; margin-left: 4px; }
.detail-actions { display: flex; padding: 12px 20px; align-items: center; justify-content: space-between; color: #7b8696; font-size: 12px; }.detail-actions div { display: flex; gap: 8px; }
.anniversary-hero { padding: 36px 24px 30px; text-align: center; position: relative; overflow: hidden; }.anniversary-hero::before { content: ''; position: absolute; width: 210px; height: 210px; border: 1px solid currentColor; opacity: .1; border-radius: 50%; top: -70px; right: -70px; pointer-events: none; }.theme-sky { background: linear-gradient(140deg, #e6f0fc, #d4e8f0); color: #395b7e; }.theme-warm { background: linear-gradient(140deg, #fff0df, #f7dee3); color: #8c5b58; }.theme-night { background: linear-gradient(140deg, #273951, #192636); color: #e1eaf6; }.anniversary-hero > span { font-size: 13px; opacity: .8; }.hero-number { font-size: clamp(48px, 5vw, 72px); line-height: 1.35; font-weight: 400; font-variant-numeric: tabular-nums; }.hero-number small { font-size: 14px; margin-left: 10px; }.anniversary-hero h2 { margin: 20px 0 8px; font-size: 21px; overflow-wrap: anywhere; }.anniversary-hero p { font-size: 12px; opacity: .8; margin: 5px 0; }
.detail-body { padding: 24px; }.anniversary-next { display: grid; gap: 8px; font-size: 12px; color: #8a94a2; }.anniversary-next strong { font-size: 16px; color: #445165; }.anniversary-hint { color: #919aaa; font-size: 12px; line-height: 1.7; margin: 10px 0; }.birthday-info { display: grid; grid-template-columns: 1.25fr 1fr 1fr; padding: 22px 0; gap: 10px; border-bottom: 1px solid #edf0f4; }.birthday-info div { display: grid; gap: 10px; }.birthday-info strong { font-size: 18px; font-weight: 500; }.birthday-info span { font-size: 11px; color: #8d96a2; }.anniversary-notes { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.9; color: #697483; margin: 22px 0; }
.anniversary-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 22px; }.anniversary-gallery button { position: relative; padding: 0; overflow: hidden; border-radius: 8px; background: #f2f4f7; }.anniversary-gallery .cover { grid-column: 1 / -1; grid-row: 1; }.anniversary-gallery img { width: 100%; aspect-ratio: 1.4; object-fit: cover; display: block; }.anniversary-gallery span { position: absolute; bottom: 8px; left: 8px; background: #0008; color: #fff; border-radius: 4px; padding: 3px 7px; font-size: 10px; }.empty-detail { text-align: center; padding: 80px 20px; color: #8b98a8; }.empty-detail > span { font-size: 56px; color: #bdd2eb; }.empty-detail h2 { font-size: 18px; }.empty-detail p { font-size: 13px; }
.anniversary-modal { width: min(560px, calc(100vw - 40px)); max-height: calc(100vh - 48px); overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }.anniversary-modal header h2 { font-size: 22px; }.anniversary-modal .anniversary-hint { margin: -8px 0 0; }.field small { font-size: 11px; font-weight: 400; color: #939eab; }.type-picker, .theme-picker { display: flex; gap: 8px; }.type-picker button { flex: 1; padding: 12px 4px; background: #f4f6f9; color: #7c8794; border-radius: 8px; display: grid; gap: 6px; font-size: 12px; }.type-picker span { font-size: 22px; }.type-picker .active { background: #e9f2ff; color: #287bd6; box-shadow: inset 0 0 0 1px #79ace9; }.theme-picker button { flex: 1; padding: 13px 8px; border-radius: 6px; }.theme-picker .active { outline: 2px solid #4b91e4; outline-offset: 2px; }
.draft-photos { display: flex; flex-wrap: wrap; gap: 10px; }.draft-photos > div { position: relative; width: 100px; display: grid; gap: 4px; }.draft-photos > div > button:first-child { padding: 0; background: #f4f6f9; border-radius: 6px; overflow: hidden; height: 80px; }.draft-photos img { width: 100%; height: 100%; object-fit: cover; }.draft-photos > div > button:nth-child(2) { background: transparent; font-size: 11px; color: #8b95a2; padding: 3px; }.draft-photos .active { color: #247bdc !important; }.remove-photo { position: absolute; top: 3px; right: 3px; border-radius: 50%; background: #0008; color: #fff; width: 22px; height: 22px; display: grid; place-items: center; }.add-photo { width: 100px; height: 80px; background: #f5f7fa; color: #8591a0; border: 1px dashed #d9e0ea; border-radius: 6px; display: grid; place-content: center; justify-items: center; gap: 5px; font-size: 11px; }.file-input { display: none; }.pin-checkbox { display: flex; align-items: center; gap: 6px; color: #667181; font-size: 13px; }.anniversary-preview { z-index: 2000; }.anniversary-preview > img { max-width: 85vw; max-height: 85vh; object-fit: contain; }.anniversary-preview > button { position: absolute; top: 24px; right: 24px; color: #fff; background: #0006; }
@media (max-width: 1050px) { .anniversary-page { padding: 24px 20px; }.anniversary-layout { grid-template-columns: minmax(240px, .85fr) minmax(280px, 1.15fr); gap: 14px; }.anniversary-row { padding: 18px 12px; gap: 8px; } }
@media (max-width: 900px) { .anniversary-layout { grid-template-columns: 1fr; } }
</style>
