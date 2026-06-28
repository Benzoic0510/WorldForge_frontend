<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { createEntry } from '@/api/entry'
import { ApiError } from '@/api/http'
import { getWorldDetail } from '@/api/world'
import type { WorldDetail } from '@/types/world'

const route = useRoute()
const router = useRouter()
const world = ref<WorldDetail | null>(null)
const loading = ref(true)
const isSubmitting = ref(false)
const errorMessage = ref('')
const tagInput = ref('')
const tags = ref<string[]>([])
const form = reactive({
  title: '',
  content: ''
})

const worldId = computed(() => String(route.params.worldId || ''))
const trimmedTitle = computed(() => form.title.trim())
const trimmedContent = computed(() => form.content.trim())
const canAddTag = computed(() => tags.value.length < 10)
const canEditWorld = computed(() => world.value?.viewer.canEdit === true)

function formatRole(role: string | null | undefined): string {
  if (role === 'creator') return '创建者'
  if (role === 'co_admin') return '共同管理员'
  if (role === 'contributor') return '协作者'
  return ''
}

const previewTags = computed(() => {
  if (tags.value.length > 0) {
    return tags.value
  }
  return ['未标记']
})

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

function splitTagInput(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function addTag(value: string) {
  const nextTags = splitTagInput(value)

  if (nextTags.length === 0) {
    return ''
  }

  for (const tag of nextTags) {
    if (tag.length > 20) {
      return '每个标签最多 20 个字符'
    }
  }

  const uniqueTags = nextTags.filter((tag, index) => {
    return !tags.value.includes(tag) && nextTags.indexOf(tag) === index
  })

  if (tags.value.length + uniqueTags.length > 10) {
    return '词条最多添加 10 个标签'
  }

  tags.value = [...tags.value, ...uniqueTags]
  tagInput.value = ''
  return ''
}

function commitTagInput() {
  errorMessage.value = addTag(tagInput.value)
}

function handleTagKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ',') {
    return
  }

  event.preventDefault()
  commitTagInput()
}

function removeTag(tag: string) {
  tags.value = tags.value.filter((item) => item !== tag)
}

function validateForm() {
  if (!trimmedTitle.value) {
    return '请输入词条标题'
  }
  if (trimmedTitle.value.length > 100) {
    return '词条标题最多 100 个字符'
  }
  if (!trimmedContent.value) {
    return '请输入词条正文'
  }
  if (trimmedContent.value.length > 100000) {
    return '词条正文最多 100000 个字符'
  }

  const pendingTagError = addTag(tagInput.value)
  if (pendingTagError) {
    return pendingTagError
  }

  return ''
}

async function loadWorld() {
  loading.value = true
  errorMessage.value = ''

  try {
    world.value = await getWorldDetail(worldId.value)
  } catch (error) {
    world.value = null
    errorMessage.value = getErrorMessage(error, '世界档案暂时无法加载，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function handleSubmit() {
  errorMessage.value = ''

  const validationMessage = validateForm()
  if (validationMessage) {
    errorMessage.value = validationMessage
    return
  }

  isSubmitting.value = true
  try {
    const entry = await createEntry(worldId.value, {
      title: trimmedTitle.value,
      content: trimmedContent.value,
      tags: tags.value
    })

    await router.push({
      name: 'entry-detail',
      params: {
        worldId: entry.worldId,
        entryId: entry.entryId
      }
    })
  } catch (error) {
    errorMessage.value = getErrorMessage(error, '词条暂时无法创建，请稍后重试。')
  } finally {
    isSubmitting.value = false
  }
}

onMounted(async () => {
  await loadWorld()
})
</script>

<template>
  <main class="create-entry-page">
    <section v-if="loading" class="entry-create-shell page-container">
      <div class="entry-state">
        <p>正在打开创作档案...</p>
      </div>
    </section>

    <section v-else-if="!world || !canEditWorld" class="entry-create-shell page-container">
      <div class="entry-state entry-state--error">
        <h1>{{ world ? '你当前无法编辑这个世界' : '世界档案暂时不可用' }}</h1>
        <p>{{ errorMessage || '请回到世界详情页确认权限后再试。' }}</p>
        <div class="state-actions">
          <RouterLink
            class="state-button state-button--primary"
            :to="{ name: 'world-detail', params: { worldId }, query: { mode: 'create' } }"
          >
            返回世界详情
          </RouterLink>
          <button type="button" class="state-button" @click="loadWorld">重新加载</button>
        </div>
      </div>
    </section>

    <section v-else class="entry-create-shell page-container">
      <nav class="entry-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'my-worlds' }">我的世界观</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId }, query: { mode: 'create' } }">
          {{ world.name }}
        </RouterLink>
        <span>/</span>
        <strong>新建词条</strong>
      </nav>

      <header class="entry-create-header">
        <div>
          <p class="eyebrow">Entry Record</p>
          <h1>记录新的设定词条</h1>
        </div>
        <p>把人物、地点、规则或事件写成可追踪的档案，让世界开始拥有可继续生长的骨架。</p>
      </header>

      <div class="entry-create-layout">
        <form class="entry-form" @submit.prevent="handleSubmit">
          <section class="form-panel">
            <div class="panel-heading">
              <p class="eyebrow">Content</p>
              <h2>词条内容</h2>
            </div>

            <label class="field-block">
              <span class="field-label">标题</span>
              <input
                v-model="form.title"
                autocomplete="off"
                name="title"
                placeholder="例如：雾灯公会"
                maxlength="100"
                type="text"
              >
            </label>

            <label class="field-block">
              <span class="field-label">正文</span>
              <textarea
                v-model="form.content"
                name="content"
                placeholder="写下这个设定的来历、作用、关联人物或冲突。"
                rows="12"
                maxlength="100000"
              ></textarea>
            </label>

            <div class="field-block">
              <span class="field-label">标签</span>
              <div class="tag-editor" :class="{ 'tag-editor--full': !canAddTag }">
                <span v-for="tag in tags" :key="tag" class="tag-chip">
                  {{ tag }}
                  <button type="button" :aria-label="`移除标签 ${tag}`" @click="removeTag(tag)">×</button>
                </span>
                <input
                  v-model="tagInput"
                  :disabled="!canAddTag"
                  maxlength="20"
                  placeholder="输入后按 Enter"
                  type="text"
                  @blur="commitTagInput"
                  @keydown="handleTagKeydown"
                >
              </div>
            </div>
          </section>

          <p v-if="errorMessage" class="form-message" role="alert">{{ errorMessage }}</p>

          <div class="submit-row">
            <button class="submit-button" type="submit" :disabled="isSubmitting">
              {{ isSubmitting ? '正在归档...' : '创建词条' }}
            </button>
            <RouterLink
              class="cancel-link"
              :to="{ name: 'world-detail', params: { worldId }, query: { mode: 'create' } }"
            >
              暂不创建
            </RouterLink>
          </div>
        </form>

        <aside class="entry-preview">
          <section class="preview-panel">
            <p class="eyebrow">Preview</p>
            <h2>{{ trimmedTitle || '未命名词条' }}</h2>
            <p>{{ trimmedContent || '正文会在这里实时预览，方便你检查词条的第一印象。' }}</p>
            <div class="preview-tags" aria-label="预览标签">
              <span v-for="tag in previewTags" :key="tag">{{ tag }}</span>
            </div>
          </section>

          <section class="world-panel">
            <p class="eyebrow">World</p>
            <strong>{{ world.name }}</strong>
            <span>{{ world.stats.entryCount }} 个现有词条</span>
            <span v-if="world.viewer.role" class="role-badge">你的权限：{{ formatRole(world.viewer.role) }}</span>
          </section>
        </aside>
      </div>
    </section>
  </main>
</template>

<style scoped>
.create-entry-page {
  padding-block: 28px 56px;
}

.entry-create-shell {
  display: grid;
  gap: 18px;
}

.entry-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.entry-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.entry-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.entry-state,
.entry-create-header,
.form-panel,
.preview-panel,
.world-panel {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.entry-state {
  display: grid;
  gap: 16px;
  min-height: 320px;
  padding: 32px;
  align-content: center;
}

.entry-state--error {
  background: rgb(108 36 36 / 6%);
}

.entry-state h1,
.entry-state p,
.entry-create-header h1,
.entry-create-header p,
.panel-heading h2,
.preview-panel h2,
.preview-panel p {
  margin: 0;
}

.entry-state h1,
.entry-create-header h1,
.panel-heading h2,
.preview-panel h2 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

.entry-state h1 {
  font-size: clamp(2rem, 3vw, 3rem);
}

.entry-state p,
.entry-create-header p,
.preview-panel p {
  color: var(--color-muted);
  line-height: 1.75;
}

.preview-panel p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.state-button,
.submit-button,
.cancel-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 8px;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.state-button,
.cancel-link {
  border: 1px solid var(--color-line-strong);
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
}

.state-button--primary,
.submit-button {
  border: 0;
  color: #fff;
  background: #103b31;
}

.submit-button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.entry-create-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.45fr);
  gap: 18px;
  align-items: end;
  padding: 24px;
}

.entry-create-header h1 {
  font-size: clamp(2.2rem, 4vw, 4.4rem);
  line-height: 1.03;
}

.entry-create-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 0.42fr);
  gap: 18px;
  align-items: start;
}

.entry-form,
.entry-preview {
  display: grid;
  gap: 18px;
}

.entry-preview {
  position: sticky;
  top: calc(var(--nav-height) + 18px);
}

.form-panel,
.preview-panel,
.world-panel {
  padding: 22px;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.panel-heading {
  margin-bottom: 20px;
}

.field-block {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.field-block:first-of-type {
  margin-top: 0;
}

.field-label {
  color: var(--color-muted);
  font-size: 0.92rem;
  font-weight: 800;
}

input,
textarea {
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font: inherit;
}

input {
  min-height: 44px;
  padding: 0 12px;
}

textarea {
  min-height: 270px;
  resize: vertical;
  padding: 12px;
  line-height: 1.75;
}

input:focus,
textarea:focus {
  border-color: var(--color-accent);
  outline: 0;
  box-shadow: var(--focus-ring);
}

.tag-editor {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 46px;
  padding: 7px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 82%);
}

.tag-editor:focus-within {
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

.tag-editor input {
  flex: 1 1 140px;
  min-width: 120px;
  min-height: 30px;
  padding: 0 4px;
  border: 0;
  background: transparent;
}

.tag-editor input:focus {
  box-shadow: none;
}

.tag-editor--full input {
  display: none;
}

.tag-chip,
.preview-tags span {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  color: #305349;
  background: rgb(232 241 237 / 72%);
  font-size: 0.84rem;
  font-weight: 800;
}

.tag-chip {
  gap: 6px;
  padding: 0 6px 0 10px;
}

.tag-chip button {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: #305349;
  background: rgb(255 255 255 / 64%);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}

.form-message {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgb(176 64 64 / 28%);
  border-radius: 8px;
  color: #8f2d2d;
  background: rgb(255 246 242 / 92%);
  font-weight: 800;
}

.submit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.preview-panel {
  display: grid;
  gap: 14px;
}

.preview-panel h2 {
  font-size: 2.2rem;
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.preview-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preview-tags span {
  padding: 0 10px;
}

.world-panel {
  display: grid;
  gap: 8px;
}

.world-panel strong {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.7rem;
  line-height: 1.12;
}

.world-panel span {
  color: var(--color-muted);
  font-weight: 800;
}

@media (max-width: 980px) {
  .entry-create-header,
  .entry-create-layout {
    grid-template-columns: 1fr;
  }

  .entry-preview {
    position: static;
  }
}

@media (max-width: 720px) {
  .create-entry-page {
    padding-block: 20px 42px;
  }

  .entry-create-header,
  .form-panel,
  .preview-panel,
  .world-panel {
    padding: 18px;
  }

  .submit-row,
  .submit-button,
  .cancel-link {
    width: 100%;
  }
}

.role-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  color: #14735a;
  background: rgb(232 241 237 / 62%);
  font-size: 0.78rem;
  font-weight: 800;
}
</style>
