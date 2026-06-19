<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { deleteWorld, getWorldDetail, updateWorld, uploadWorldImage } from '@/api/world'
import type { WorldDetail, WorldVisibility } from '@/types/world'

interface VisibilityOption {
  value: WorldVisibility
  label: string
  description: string
}

const route = useRoute()
const router = useRouter()
const world = ref<WorldDetail | null>(null)
const loading = ref(true)
const isSubmitting = ref(false)
const isDeleting = ref(false)
const errorMessage = ref('')
const deleteErrorMessage = ref('')
const deleteConfirmName = ref('')
const tagInput = ref('')
const tags = ref<string[]>([])
const coverImageFailed = ref(false)
const coverFileInput = ref<HTMLInputElement | null>(null)
const coverFile = ref<File | null>(null)
const coverPreviewUrl = ref('')
const form = reactive({
  name: '',
  description: '',
  coverImageUrl: '',
  visibility: 'private' as WorldVisibility,
  allowFork: false,
  allowMerge: false
})

const visibilityOptions: VisibilityOption[] = [
  {
    value: 'private',
    label: '私有',
    description: '仅通过邀请码加入，对成员可见。适合内部协作。'
  },
  {
    value: 'protected',
    label: '受保护',
    description: '不会公开展示，用户可申请加入或使用邀请码。'
  },
  {
    value: 'public',
    label: '公开',
    description: '进入发现页可见，任何登录用户都可直接加入。'
  }
]

const worldId = computed(() => String(route.params.worldId || ''))
const trimmedName = computed(() => form.name.trim())
const trimmedDescription = computed(() => form.description.trim())
const trimmedCoverUrl = computed(() => form.coverImageUrl.trim())
const coverPreviewSrc = computed(() => coverPreviewUrl.value || trimmedCoverUrl.value)
const selectedCoverName = computed(() => coverFile.value?.name || '')
const canAddTag = computed(() => tags.value.length < 10)
const canManageWorld = computed(() => {
  const role = world.value?.viewer.role
  return role === 'creator' || role === 'co_admin'
})
const canDeleteWorld = computed(() => world.value?.viewer.role === 'creator')
const canSubmitDelete = computed(() => {
  return canDeleteWorld.value && deleteConfirmName.value.trim() === world.value?.name
})
const selectedVisibility = computed(() => {
  return visibilityOptions.find((option) => option.value === form.visibility) || visibilityOptions[0]
})
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
    return '世界最多添加 10 个标签'
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

function openCoverPicker() {
  coverFileInput.value?.click()
}

function revokeCoverPreview() {
  if (coverPreviewUrl.value) {
    URL.revokeObjectURL(coverPreviewUrl.value)
    coverPreviewUrl.value = ''
  }
}

function handleCoverSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  revokeCoverPreview()
  coverImageFailed.value = false
  coverFile.value = file
  if (file) {
    coverPreviewUrl.value = URL.createObjectURL(file)
  }
}

function clearSelectedCover() {
  coverFile.value = null
  coverImageFailed.value = false
  revokeCoverPreview()
  if (coverFileInput.value) {
    coverFileInput.value.value = ''
  }
}

function validateForm() {
  if (trimmedName.value.length < 2 || trimmedName.value.length > 50) {
    return '世界名称需要 2 到 50 个字符'
  }
  if (trimmedDescription.value.length > 500) {
    return '世界简介最多 500 个字符'
  }
  if (trimmedCoverUrl.value.length > 255) {
    return '封面文件名最多 255 个字符'
  }
  if (coverFile.value && coverFile.value.size > 5 * 1024 * 1024) {
    return '封面图片最多 5MB'
  }

  const pendingTagError = addTag(tagInput.value)
  if (pendingTagError) {
    return pendingTagError
  }

  return ''
}

function hydrateForm(nextWorld: WorldDetail) {
  clearSelectedCover()
  form.name = nextWorld.name
  form.description = nextWorld.description
  form.coverImageUrl = nextWorld.coverImageUrl
  form.visibility = nextWorld.visibility
  form.allowFork = nextWorld.allowFork
  form.allowMerge = nextWorld.allowMerge
  tags.value = [...nextWorld.tags]
  tagInput.value = ''
  coverImageFailed.value = false
}

async function loadWorld() {
  loading.value = true
  errorMessage.value = ''

  try {
    const detail = await getWorldDetail(worldId.value)
    world.value = detail
    hydrateForm(detail)
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
    let updated = await updateWorld(worldId.value, {
      name: trimmedName.value,
      description: trimmedDescription.value,
      coverImageUrl: trimmedCoverUrl.value,
      visibility: form.visibility,
      allowFork: form.allowFork,
      allowMerge: form.allowMerge,
      tags: tags.value
    })

    if (coverFile.value) {
      const uploaded = await uploadWorldImage(worldId.value, coverFile.value)
      updated = {
        ...updated,
        coverImageUrl: uploaded.url
      }
    }

    await router.push({
      name: 'world-detail',
      params: { worldId: updated.worldId }
    })
  } catch (error) {
    errorMessage.value = getErrorMessage(error, '世界信息暂时无法保存，请稍后重试。')
  } finally {
    isSubmitting.value = false
  }
}

async function handleDeleteWorld() {
  if (!world.value || !canSubmitDelete.value || isDeleting.value) {
    return
  }

  deleteErrorMessage.value = ''
  isDeleting.value = true
  try {
    await deleteWorld(worldId.value)
    await router.push({ name: 'discover' })
  } catch (error) {
    deleteErrorMessage.value = getErrorMessage(error, '世界暂时无法删除，请稍后重试。')
  } finally {
    isDeleting.value = false
  }
}

onMounted(async () => {
  await loadWorld()
})

onBeforeUnmount(() => {
  revokeCoverPreview()
})
</script>

<template>
  <main class="edit-world-page">
    <section v-if="loading" class="edit-shell page-container">
      <div class="edit-state">
        <p>正在调取世界档案...</p>
      </div>
    </section>

    <section v-else-if="!world || !canManageWorld" class="edit-shell page-container">
      <div class="edit-state edit-state--error">
        <h1>{{ world ? '你当前无法编辑世界信息' : '世界档案暂时不可用' }}</h1>
        <p>{{ errorMessage || '只有创建者和协管可以修改世界基础信息。' }}</p>
        <div class="state-actions">
          <RouterLink
            class="state-button state-button--primary"
            :to="{ name: 'world-detail', params: { worldId } }"
          >
            返回世界详情
          </RouterLink>
          <button type="button" class="state-button" @click="loadWorld">重新加载</button>
        </div>
      </div>
    </section>

    <section v-else class="edit-shell page-container">
      <nav class="edit-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'my-worlds' }">我的世界观</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId }, query: { mode: 'create' } }">
          {{ world.name }}
        </RouterLink>
        <span>/</span>
        <strong>编辑世界信息</strong>
      </nav>

      <header class="edit-header">
        <div>
          <p class="eyebrow">World Settings</p>
          <h1>编辑世界档案</h1>
        </div>
        <p>调整公开档案、访问策略和协作前的基础设定；词条内容仍在词条管理中维护。</p>
      </header>

      <div class="edit-layout">
        <form class="edit-form" @submit.prevent="handleSubmit">
          <section class="form-panel" aria-labelledby="basic-title">
            <div class="panel-heading">
              <p class="eyebrow">Identity</p>
              <h2 id="basic-title">基础信息</h2>
            </div>

            <label class="field-block">
              <span class="field-label">
                世界名称
                <small>{{ trimmedName.length }}/50</small>
              </span>
              <input
                v-model="form.name"
                autocomplete="off"
                maxlength="50"
                name="name"
                placeholder="例如：雾港纪年"
                type="text"
              >
            </label>

            <label class="field-block">
              <span class="field-label">
                简介
                <small>{{ trimmedDescription.length }}/500</small>
              </span>
              <textarea
                v-model="form.description"
                maxlength="500"
                name="description"
                placeholder="一句话说明世界的时代、冲突或气质。"
                rows="5"
              ></textarea>
            </label>

            <div class="field-block">
              <span class="field-label">
                世界封面
                <small>{{ selectedCoverName || '可选' }}</small>
              </span>
              <input
                ref="coverFileInput"
                accept="image/jpeg,image/png,image/webp,image/gif"
                class="visually-hidden"
                name="coverImage"
                type="file"
                @change="handleCoverSelected"
              >
              <div class="image-upload-box">
                <button class="upload-button" type="button" @click="openCoverPicker">
                  {{ coverFile ? '更换图片' : '选择新封面' }}
                </button>
                <button
                  v-if="coverFile"
                  class="upload-button upload-button--ghost"
                  type="button"
                  @click="clearSelectedCover"
                >
                  取消选择
                </button>
                <span>{{ coverFile ? selectedCoverName : '保留当前封面，或上传 JPG、PNG、WebP、GIF' }}</span>
              </div>
            </div>

            <div class="field-block">
              <span class="field-label">
                标签
                <small>{{ tags.length }}/10</small>
              </span>
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

          <section class="form-panel" aria-labelledby="rules-title">
            <div class="panel-heading">
              <p class="eyebrow">Access</p>
              <h2 id="rules-title">开放策略</h2>
            </div>

            <div class="visibility-grid" role="radiogroup" aria-label="可见性">
              <label
                v-for="option in visibilityOptions"
                :key="option.value"
                class="visibility-card"
                :class="{ 'visibility-card--active': form.visibility === option.value }"
              >
                <input v-model="form.visibility" name="visibility" type="radio" :value="option.value">
                <strong>{{ option.label }}</strong>
                <span>{{ option.description }}</span>
              </label>
            </div>

            <label class="switch-row">
              <input v-model="form.allowFork" type="checkbox">
              <span>
                <strong>允许 Fork</strong>
                <small>其他创作者可以基于该世界生成分支版本。</small>
              </span>
            </label>

            <label class="switch-row">
              <input v-model="form.allowMerge" type="checkbox">
              <span>
                <strong>允许 Merge</strong>
                <small>后续分支内容可以被合并回该世界。</small>
              </span>
            </label>
          </section>

          <p v-if="errorMessage" class="form-message" role="alert">{{ errorMessage }}</p>

          <div class="submit-row">
            <button class="submit-button" type="submit" :disabled="isSubmitting">
              {{ isSubmitting ? '正在保存...' : '保存世界信息' }}
            </button>
            <RouterLink class="cancel-link" :to="{ name: 'world-detail', params: { worldId } }">
              取消编辑
            </RouterLink>
          </div>

          <section v-if="canDeleteWorld" class="danger-panel" aria-labelledby="delete-world-title">
            <div class="panel-heading">
              <p class="eyebrow">Danger Zone</p>
              <h2 id="delete-world-title">删除世界</h2>
            </div>
            <p class="danger-copy">
              删除后这个世界将从列表和详情页隐藏。词条、故事线和审核记录会保留在数据库中用于审计与排查。
            </p>
            <label class="field-block">
              <span class="field-label">
                输入世界名确认
                <small>{{ world.name }}</small>
              </span>
              <input
                v-model="deleteConfirmName"
                autocomplete="off"
                name="deleteConfirmName"
                type="text"
                :placeholder="world.name"
              >
            </label>
            <p v-if="deleteErrorMessage" class="form-message" role="alert">{{ deleteErrorMessage }}</p>
            <button
              class="delete-button"
              type="button"
              :disabled="!canSubmitDelete || isDeleting"
              @click="handleDeleteWorld"
            >
              {{ isDeleting ? '正在删除...' : '删除这个世界' }}
            </button>
          </section>
        </form>

        <aside class="preview-column" aria-label="世界档案预览">
          <section class="preview-card">
            <div
              class="cover-preview"
              :class="{ 'cover-preview--empty': !coverPreviewSrc || coverImageFailed }"
            >
              <img
                v-if="coverPreviewSrc && !coverImageFailed"
                :src="coverPreviewSrc"
                :alt="`${trimmedName || '世界'} 封面预览`"
                @error="coverImageFailed = true"
              >
              <div v-else class="cover-fallback" aria-hidden="true">
                <span>World Record</span>
                <strong>{{ trimmedName || '未命名世界' }}</strong>
              </div>
            </div>

            <div class="preview-body">
              <p class="eyebrow">Preview</p>
              <h2>{{ trimmedName || '未命名世界' }}</h2>
              <p>{{ trimmedDescription || '简介会在这里实时预览，帮助你检查公开档案的第一印象。' }}</p>
              <div class="preview-tags" aria-label="预览标签">
                <span v-for="tag in previewTags" :key="tag">{{ tag }}</span>
              </div>
            </div>
          </section>

          <section class="rules-summary">
            <p class="eyebrow">Policy</p>
            <dl>
              <div>
                <dt>可见性</dt>
                <dd>{{ selectedVisibility.label }}</dd>
              </div>
              <div>
                <dt>Fork</dt>
                <dd>{{ form.allowFork ? '允许' : '关闭' }}</dd>
              </div>
              <div>
                <dt>Merge</dt>
                <dd>{{ form.allowMerge ? '允许' : '关闭' }}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  </main>
</template>

<style scoped>
.edit-world-page {
  padding-block: 32px 64px;
}

.edit-shell {
  display: grid;
  gap: 22px;
}

.edit-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.edit-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.edit-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.edit-state,
.edit-header,
.form-panel,
.danger-panel,
.preview-card,
.rules-summary {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 70%), rgb(244 240 231 / 88%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.edit-state {
  display: grid;
  gap: 16px;
  min-height: 320px;
  padding: 32px;
  align-content: center;
}

.edit-state--error {
  background: rgb(108 36 36 / 6%);
}

.edit-state h1,
.edit-state p,
.edit-header h1,
.edit-header p,
.panel-heading h2,
.preview-body h2,
.preview-body p {
  margin: 0;
}

.edit-state h1,
.edit-header h1,
.panel-heading h2,
.preview-body h2 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

.edit-state h1 {
  font-size: clamp(2rem, 3vw, 3rem);
}

.edit-state p,
.edit-header p,
.preview-body p {
  color: var(--color-muted);
  line-height: 1.75;
}

.state-actions,
.submit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.state-button,
.submit-button,
.delete-button,
.cancel-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 18px;
  border-radius: 8px;
  font-weight: 900;
  text-decoration: none;
}

.state-button,
.cancel-link {
  border: 1px solid var(--color-line-strong);
  color: var(--color-ink);
  background: rgb(255 255 255 / 58%);
}

.state-button--primary,
.submit-button {
  border: 0;
  color: #fff;
  background: #103b31;
}

.submit-button {
  cursor: pointer;
}

.submit-button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.delete-button {
  width: fit-content;
  border: 1px solid rgb(143 45 45 / 32%);
  color: #fff;
  background: #8f2d2d;
  cursor: pointer;
}

.delete-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.edit-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.55fr);
  gap: 24px;
  align-items: end;
  padding: 24px;
}

.edit-header h1 {
  font-size: clamp(2.2rem, 4.2vw, 4.7rem);
  line-height: 1.02;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.edit-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.42fr);
  gap: 18px;
  align-items: start;
}

.edit-form,
.preview-column {
  display: grid;
  gap: 18px;
}

.form-panel,
.danger-panel,
.rules-summary {
  padding: 22px;
}

.danger-panel {
  display: grid;
  gap: 14px;
  border-color: rgb(143 45 45 / 26%);
  background:
    linear-gradient(180deg, rgb(255 255 255 / 72%), rgb(255 246 242 / 88%)),
    rgb(255 255 255 / 58%);
}

.danger-copy {
  margin: 0;
  color: #8f2d2d;
  line-height: 1.7;
  font-weight: 700;
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
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  color: var(--color-muted);
  font-size: 0.92rem;
  font-weight: 800;
}

.field-label small {
  color: #7a8783;
  font-size: 0.78rem;
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
  min-height: 154px;
  resize: vertical;
  padding: 12px;
  line-height: 1.75;
}

input:focus,
textarea:focus {
  border-color: var(--color-accent);
  outline: 3px solid rgb(20 115 90 / 14%);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.image-upload-box {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  min-height: 46px;
  padding: 8px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 82%);
}

.image-upload-box span {
  min-width: 0;
  color: var(--color-muted);
  font-size: 0.86rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.upload-button {
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: #103b31;
  font-weight: 900;
  cursor: pointer;
}

.upload-button--ghost {
  border: 1px solid var(--color-line-strong);
  color: var(--color-ink);
  background: rgb(255 255 255 / 64%);
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
  outline: 0;
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

.visibility-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.visibility-card {
  display: grid;
  gap: 8px;
  min-height: 138px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 54%);
  cursor: pointer;
}

.visibility-card input {
  width: 16px;
  min-height: 16px;
  accent-color: var(--color-accent);
}

.visibility-card strong,
.switch-row strong {
  color: var(--color-ink);
}

.visibility-card span,
.switch-row small {
  color: var(--color-muted);
  line-height: 1.6;
}

.visibility-card--active {
  border-color: rgb(20 115 90 / 38%);
  background: rgb(232 241 237 / 78%);
}

.switch-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 16px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 46%);
}

.switch-row input {
  flex: 0 0 auto;
  width: 18px;
  min-height: 18px;
  margin-top: 3px;
  accent-color: var(--color-accent);
}

.switch-row span {
  display: grid;
  gap: 4px;
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

.preview-column {
  position: sticky;
  top: calc(var(--nav-height) + 18px);
}

.preview-card {
  overflow: hidden;
}

.cover-preview {
  min-height: 310px;
  background: #103b31;
}

.cover-preview img {
  display: block;
  width: 100%;
  height: 310px;
  object-fit: cover;
}

.cover-preview--empty {
  background:
    linear-gradient(135deg, rgb(16 59 49 / 95%), rgb(45 96 78 / 92%)),
    #103b31;
}

.cover-fallback {
  display: grid;
  min-height: 310px;
  padding: 24px;
  align-content: space-between;
  color: rgb(246 242 232 / 92%);
}

.cover-fallback span {
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.cover-fallback strong {
  font-family: var(--font-display);
  font-size: clamp(1.7rem, 3vw, 3rem);
  line-height: 1.08;
  overflow-wrap: anywhere;
}

.preview-body {
  display: grid;
  gap: 14px;
  padding: 22px;
}

.preview-body h2 {
  font-size: 2rem;
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

.rules-summary dl {
  display: grid;
  gap: 12px;
  margin: 0;
}

.rules-summary div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.rules-summary dt {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 900;
  text-transform: uppercase;
}

.rules-summary dd {
  margin: 0;
  color: var(--color-ink);
  font-weight: 900;
}

@media (max-width: 1040px) {
  .edit-header,
  .edit-layout {
    grid-template-columns: 1fr;
  }

  .preview-column {
    position: static;
  }
}

@media (max-width: 760px) {
  .edit-world-page {
    padding-block: 22px 44px;
  }

  .edit-state,
  .edit-header,
  .form-panel,
  .danger-panel,
  .preview-body,
  .rules-summary {
    padding: 18px;
  }

  .visibility-grid {
    grid-template-columns: 1fr;
  }

  .submit-row,
  .submit-button,
  .delete-button,
  .cancel-link {
    width: 100%;
  }
}
</style>
