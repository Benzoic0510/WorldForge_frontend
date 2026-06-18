<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, reactive } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { createOc, listMyOcs, updateOc, uploadOcAvatar } from '@/api/rpg'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import type { OcResponse } from '@/types/rpg'

const route = useRoute()
const authStore = useAuthStore()

const worldId = computed(() => String(route.params.worldId || ''))

// ─── State ────────────────────────────────────────────────────

const ocs = ref<OcResponse[]>([])
const loading = ref(true)
const errorMessage = ref('')

// 创建表单
interface AttributeRow {
  id: number
  key: string
  value: string
  type: 'string' | 'number' | 'boolean'
}

let nextAttrId = 0
function nextAttrRowId() {
  return nextAttrId++
}

const createForm = reactive({
  name: '',
  avatarUrl: '',
  bio: '',
  attributeRows: [] as AttributeRow[]
})

const formError = ref('')
const isSubmitting = ref(false)
const createAvatarInputRef = ref<HTMLInputElement | null>(null)
const createAvatarPreview = ref('')
const createAvatarUploading = ref(false)

// 创建表单展开/收起
const showCreateForm = ref(false)

function openCreateModal() {
  resetCreateForm()
  showCreateForm.value = true
}

function closeCreateModal() {
  showCreateForm.value = false
  formError.value = ''
}

// 编辑模式
const editingOcId = ref<string | null>(null)

// 编辑表单（每个编辑中的卡片独立状态）
const editForm = reactive({
  name: '',
  avatarUrl: '',
  bio: '',
  attributeRows: [] as AttributeRow[]
})

const editError = ref('')
const isEditSubmitting = ref(false)
const editAvatarInputRef = ref<HTMLInputElement | null>(null)
const editAvatarPreview = ref('')
const editAvatarUploading = ref(false)

// ─── Characters remaining ─────────────────────────────────────

const nameCharsRemaining = computed(() => 50 - createForm.name.length)
const bioCharsRemaining = computed(() => 500 - createForm.bio.length)

const editNameChars = computed(() => 50 - editForm.name.length)
const editBioChars = computed(() => 500 - editForm.bio.length)

// ─── Helpers ──────────────────────────────────────────────────

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  return '操作失败，请稍后重试。'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getInitialChar(name: string): string {
  return name.charAt(0)
}

function clearFileInput(input: HTMLInputElement | null) {
  if (input) {
    input.value = ''
  }
}

async function uploadAvatarFile(
  file: File,
  target: 'create' | 'edit'
) {
  const uploading = target === 'create' ? createAvatarUploading : editAvatarUploading
  const error = target === 'create' ? formError : editError
  uploading.value = true
  error.value = ''

  try {
    const uploaded = await uploadOcAvatar(worldId.value, file)
    if (target === 'create') {
      createForm.avatarUrl = uploaded.fileName
      createAvatarPreview.value = uploaded.url
    } else {
      editForm.avatarUrl = uploaded.fileName
      editAvatarPreview.value = uploaded.url
    }
  } catch (uploadError) {
    error.value = getErrorMessage(uploadError)
  } finally {
    uploading.value = false
  }
}

async function handleCreateAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    await uploadAvatarFile(file, 'create')
  }
  clearFileInput(input)
}

async function handleEditAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    await uploadAvatarFile(file, 'edit')
  }
  clearFileInput(input)
}

// ─── Attributes helpers ───────────────────────────────────────

function addAttributeRow(targetRows: AttributeRow[]) {
  targetRows.push({
    id: nextAttrRowId(),
    key: '',
    value: '',
    type: 'string'
  })
}

function removeAttributeRow(targetRows: AttributeRow[], index: number) {
  targetRows.splice(index, 1)
}

function attributesToPayload(rows: AttributeRow[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    switch (row.type) {
      case 'number': {
        const num = Number(row.value.trim())
        result[key] = Number.isFinite(num) ? num : null
        break
      }
      case 'boolean':
        result[key] = row.value === 'true'
        break
      default:
        result[key] = row.value.trim()
    }
  }
  return result
}

function responseToAttributeRows(attributes: Record<string, unknown> | null | undefined): AttributeRow[] {
  if (!attributes) return []
  const rows: AttributeRow[] = []
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'boolean') {
      rows.push({ id: nextAttrRowId(), key, value: String(value), type: 'boolean' })
    } else if (typeof value === 'number') {
      rows.push({ id: nextAttrRowId(), key, value: String(value), type: 'number' })
    } else {
      rows.push({ id: nextAttrRowId(), key, value: String(value ?? ''), type: 'string' })
    }
  }
  return rows
}

function getAttrDisplayValue(row: AttributeRow): string {
  if (row.type === 'boolean') return row.value === 'true' ? '是' : '否'
  return row.value
}

// ─── Validation ───────────────────────────────────────────────

function validateCreateForm(): string | null {
  if (createAvatarUploading.value) return '头像仍在上传，请稍后再提交'
  const name = createForm.name.trim()
  if (!name) return '请输入角色名称'
  if (name.length > 50) return '角色名称不能超过 50 个字符'
  for (const row of createForm.attributeRows) {
    if (!row.key.trim()) return '属性键不能为空'
    if (row.type === 'number' && row.value.trim() && !Number.isFinite(Number(row.value.trim()))) {
      return `属性"${row.key.trim()}"的值不是有效数字`
    }
  }
  // 检查重复 key
  const keys = createForm.attributeRows.map(r => r.key.trim()).filter(Boolean)
  if (new Set(keys).size !== keys.length) return '属性键不能重复'
  return null
}

function validateEditForm(): string | null {
  if (editAvatarUploading.value) return '头像仍在上传，请稍后再提交'
  const name = editForm.name.trim()
  if (!name) return '请输入角色名称'
  if (name.length > 50) return '角色名称不能超过 50 个字符'
  for (const row of editForm.attributeRows) {
    if (!row.key.trim()) return '属性键不能为空'
    if (row.type === 'number' && row.value.trim() && !Number.isFinite(Number(row.value.trim()))) {
      return `属性"${row.key.trim()}"的值不是有效数字`
    }
  }
  const keys = editForm.attributeRows.map(r => r.key.trim()).filter(Boolean)
  if (new Set(keys).size !== keys.length) return '属性键不能重复'
  return null
}

// ─── Create ───────────────────────────────────────────────────

async function handleCreate() {
  formError.value = ''
  const validationError = validateCreateForm()
  if (validationError) {
    formError.value = validationError
    return
  }

  isSubmitting.value = true
  try {
    const oc = await createOc(worldId.value, {
      name: createForm.name.trim(),
      avatarUrl: createForm.avatarUrl.trim() || undefined,
      bio: createForm.bio.trim() || undefined,
      attributes: attributesToPayload(createForm.attributeRows)
    })

    ocs.value.unshift(oc)
    closeCreateModal()
  } catch (error) {
    formError.value = getErrorMessage(error)
  } finally {
    isSubmitting.value = false
  }
}

function resetCreateForm() {
  createForm.name = ''
  createForm.avatarUrl = ''
  createForm.bio = ''
  createForm.attributeRows = []
  createAvatarPreview.value = ''
  createAvatarUploading.value = false
  formError.value = ''
}

// ─── Edit ─────────────────────────────────────────────────────

function startEditing(oc: OcResponse) {
  editingOcId.value = oc.ocId
  editForm.name = oc.name
  editForm.avatarUrl = oc.avatarUrl || ''
  editAvatarPreview.value = oc.avatarUrl || ''
  editForm.bio = oc.bio || ''
  editForm.attributeRows = responseToAttributeRows(oc.attributes)
  editError.value = ''
  isEditSubmitting.value = false
}

function cancelEditing() {
  editingOcId.value = null
  editAvatarPreview.value = ''
  editAvatarUploading.value = false
  editError.value = ''
}

async function handleUpdate(ocId: string) {
  editError.value = ''
  const validationError = validateEditForm()
  if (validationError) {
    editError.value = validationError
    return
  }

  isEditSubmitting.value = true
  try {
    const updated = await updateOc(worldId.value, ocId, {
      name: editForm.name.trim(),
      avatarUrl: editForm.avatarUrl.trim() || undefined,
      bio: editForm.bio.trim() || undefined,
      attributes: attributesToPayload(editForm.attributeRows)
    })

    const index = ocs.value.findIndex(o => o.ocId === ocId)
    if (index !== -1) {
      ocs.value[index] = updated
    }
    cancelEditing()
  } catch (error) {
    editError.value = getErrorMessage(error)
  } finally {
    isEditSubmitting.value = false
  }
}

// ─── Fetch OCs ────────────────────────────────────────────────

async function fetchOcs() {
  loading.value = true
  errorMessage.value = ''
  try {
    ocs.value = await listMyOcs(worldId.value)
  } catch (error) {
    ocs.value = []
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

// ─── Lifecycle ────────────────────────────────────────────────

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && showCreateForm.value) {
    closeCreateModal()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  fetchOcs()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <main class="oc-list-page page-container">
    <!-- Header -->
    <section class="page-header">
      <p class="eyebrow">RPG 角色</p>
      <h1>角色管理</h1>
      <RouterLink
        class="back-link"
        :to="{ name: 'rpg-chat', params: { worldId } }"
      >
        返回聊天
      </RouterLink>
    </section>

    <!-- OC List -->
    <section class="list-section" aria-labelledby="list-title">
      <div class="list-header">
        <h2 id="list-title" class="section-title">我的角色</h2>
        <button
          class="create-btn"
          type="button"
          @click="openCreateModal"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          创建角色
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="inline-state">
        <p>正在读取角色档案...</p>
      </div>

      <!-- Error -->
      <div v-else-if="errorMessage" class="inline-state inline-state--error">
        <p>{{ errorMessage }}</p>
        <button class="state-retry-btn" @click="fetchOcs">重新加载</button>
      </div>

      <!-- Empty -->
      <div v-else-if="ocs.length === 0" class="inline-state">
        <p>还没有创建任何角色，点击上方「+ 创建角色」按钮创建第一个吧。</p>
      </div>

      <!-- Cards -->
      <div v-else class="oc-grid">
        <article
          v-for="oc in ocs"
          :key="oc.ocId"
          class="oc-card"
          :class="{ 'oc-card--editing': editingOcId === oc.ocId }"
        >
          <!-- Display mode -->
          <template v-if="editingOcId !== oc.ocId">
            <div class="oc-card-top">
              <div class="oc-avatar">
                <img
                  v-if="oc.avatarUrl"
                  :src="oc.avatarUrl"
                  alt=""
                  class="oc-avatar-img"
                />
                <span v-else class="oc-avatar-fallback">
                  {{ getInitialChar(oc.name) }}
                </span>
              </div>
              <div class="oc-card-header">
                <h3 class="oc-name">{{ oc.name }}</h3>
                <time class="oc-time">{{ formatDate(oc.createdAt) }}</time>
              </div>
            </div>

            <p v-if="oc.bio" class="oc-bio">{{ oc.bio }}</p>

            <div
              v-if="oc.attributes && Object.keys(oc.attributes).length > 0"
              class="oc-attrs"
            >
              <span
                v-for="(val, key) in oc.attributes"
                :key="key"
                class="oc-attr-tag"
              >
                {{ key }}:
                {{ typeof val === 'boolean' ? (val ? '是' : '否') : val }}
              </span>
            </div>

            <button
              class="oc-edit-btn"
              type="button"
              @click="startEditing(oc)"
            >
              编辑
            </button>
          </template>

          <!-- Edit mode -->
          <template v-else>
            <div class="edit-form-inner">
              <label class="form-field">
                <span class="field-label"
                  >名称 <span class="field-required">*</span></span
                >
                <input
                  v-model="editForm.name"
                  type="text"
                  class="field-input"
                  maxlength="50"
                />
                <span
                  class="char-count"
                  :class="{ 'char-count--warn': editNameChars < 5 }"
                >
                  {{ editNameChars }}
                </span>
              </label>

              <div class="avatar-upload-field avatar-upload-field--compact">
                <span class="field-label">头像</span>
                <button
                  class="avatar-upload"
                  type="button"
                  :disabled="editAvatarUploading"
                  @click="editAvatarInputRef?.click()"
                >
                  <span class="avatar-upload__preview">
                    <img v-if="editAvatarPreview" :src="editAvatarPreview" alt="" />
                    <span v-else>{{ getInitialChar(editForm.name || '角') }}</span>
                  </span>
                  <span class="avatar-upload__copy">
                    {{ editAvatarUploading ? '上传中...' : '点击更换头像' }}
                  </span>
                </button>
                <input
                  ref="editAvatarInputRef"
                  class="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  @change="handleEditAvatarChange"
                />
              </div>

              <label class="form-field">
                <span class="field-label">简介</span>
                <textarea
                  v-model="editForm.bio"
                  class="field-input field-textarea"
                  maxlength="500"
                  rows="2"
                ></textarea>
                <span
                  class="char-count"
                  :class="{ 'char-count--warn': editBioChars < 10 }"
                >
                  {{ editBioChars }}
                </span>
              </label>

              <!-- Edit attributes -->
              <fieldset class="attributes-fieldset attributes-fieldset--compact">
                <legend class="field-label">属性</legend>

                <div
                  v-for="(row, index) in editForm.attributeRows"
                  :key="row.id"
                  class="attr-row"
                >
                  <label class="form-field attr-key">
                    <span class="field-label--compact">键</span>
                    <input
                      v-model="row.key"
                      type="text"
                      class="field-input"
                    />
                  </label>
                  <label class="form-field attr-type">
                    <span class="field-label--compact">类型</span>
                    <select v-model="row.type" class="field-input">
                      <option value="string">文本</option>
                      <option value="number">数字</option>
                      <option value="boolean">布尔</option>
                    </select>
                  </label>
                  <label class="form-field attr-value">
                    <span class="field-label--compact">值</span>
                    <template v-if="row.type === 'boolean'">
                      <select v-model="row.value" class="field-input">
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    </template>
                    <template v-else>
                      <input
                        v-model="row.value"
                        :type="row.type === 'number' ? 'number' : 'text'"
                        class="field-input"
                      />
                    </template>
                  </label>
                  <button
                    type="button"
                    class="attr-remove-btn"
                    title="删除"
                    @click="removeAttributeRow(editForm.attributeRows, index)"
                  >
                    &times;
                  </button>
                </div>

                <button
                  type="button"
                  class="attr-add-btn"
                  @click="addAttributeRow(editForm.attributeRows)"
                >
                  + 添加属性
                </button>
              </fieldset>

              <div v-if="editError" class="form-message form-message--error">
                {{ editError }}
              </div>

              <div class="edit-actions">
                <button
                  class="submit-btn submit-btn--compact"
                  :disabled="isEditSubmitting"
                  @click="handleUpdate(oc.ocId)"
                >
                  <span v-if="isEditSubmitting" class="spinner"></span>
                  <span v-else>保存</span>
                </button>
                <button
                  class="cancel-btn"
                  type="button"
                  @click="cancelEditing"
                >
                  取消
                </button>
              </div>
            </div>
          </template>
        </article>
      </div>
    </section>

    <!-- Create modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showCreateForm"
          class="modal-overlay"
          @click.self="closeCreateModal"
        >
          <div class="modal-card" aria-labelledby="create-title" role="dialog" aria-modal="true">
            <div class="modal-header">
              <h2 id="create-title" class="modal-title">创建新角色</h2>
              <button
                class="modal-close-btn"
                type="button"
                aria-label="关闭"
                @click="closeCreateModal"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>

            <div class="modal-body">
              <div class="form-grid">
                <label class="form-field form-field--wide">
                  <span class="field-label"
                    >名称 <span class="field-required">*</span></span
                  >
                  <input
                    v-model="createForm.name"
                    type="text"
                    class="field-input"
                    maxlength="50"
                    placeholder="输入角色名称"
                  />
                  <span
                    class="char-count"
                    :class="{ 'char-count--warn': nameCharsRemaining < 5 }"
                  >
                    {{ nameCharsRemaining }}
                  </span>
                </label>

                <div class="avatar-upload-field form-field--wide">
                  <span class="field-label">头像</span>
                  <button
                    class="avatar-upload avatar-upload--large"
                    type="button"
                    :disabled="createAvatarUploading"
                    @click="createAvatarInputRef?.click()"
                  >
                    <span class="avatar-upload__preview avatar-upload__preview--large">
                      <img v-if="createAvatarPreview" :src="createAvatarPreview" alt="" />
                      <span v-else>{{ getInitialChar(createForm.name || '角') }}</span>
                    </span>
                    <span class="avatar-upload__copy">
                      {{ createAvatarUploading ? '上传中...' : '点击上传头像' }}
                    </span>
                  </button>
                  <input
                    ref="createAvatarInputRef"
                    class="visually-hidden"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    @change="handleCreateAvatarChange"
                  />
                </div>

                <label class="form-field form-field--wide">
                  <span class="field-label">简介</span>
                  <textarea
                    v-model="createForm.bio"
                    class="field-input field-textarea"
                    maxlength="500"
                    rows="3"
                    placeholder="简要描述这个角色..."
                  ></textarea>
                  <span
                    class="char-count"
                    :class="{ 'char-count--warn': bioCharsRemaining < 10 }"
                  >
                    {{ bioCharsRemaining }}
                  </span>
                </label>
              </div>

              <!-- Attributes -->
              <fieldset class="attributes-fieldset">
                <legend class="section-title section-title--sub">属性</legend>

                <div v-if="createForm.attributeRows.length === 0" class="attr-empty">
                  暂无属性，点击下方按钮添加。
                </div>

                <div
                  v-for="(row, index) in createForm.attributeRows"
                  :key="row.id"
                  class="attr-row"
                >
                  <label class="form-field attr-key">
                    <span class="field-label--compact">键</span>
                    <input
                      v-model="row.key"
                      type="text"
                      class="field-input"
                      placeholder="如：种族"
                    />
                  </label>

                  <label class="form-field attr-type">
                    <span class="field-label--compact">类型</span>
                    <select v-model="row.type" class="field-input">
                      <option value="string">文本</option>
                      <option value="number">数字</option>
                      <option value="boolean">布尔</option>
                    </select>
                  </label>

                  <label class="form-field attr-value">
                    <span class="field-label--compact">值</span>
                    <template v-if="row.type === 'boolean'">
                      <select v-model="row.value" class="field-input">
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    </template>
                    <template v-else>
                      <input
                        v-model="row.value"
                        :type="row.type === 'number' ? 'number' : 'text'"
                        class="field-input"
                        :placeholder="row.type === 'number' ? '0' : '值'"
                      />
                    </template>
                  </label>

                  <button
                    type="button"
                    class="attr-remove-btn"
                    title="删除此属性"
                    @click="removeAttributeRow(createForm.attributeRows, index)"
                  >
                    &times;
                  </button>
                </div>

                <button
                  type="button"
                  class="attr-add-btn"
                  @click="addAttributeRow(createForm.attributeRows)"
                >
                  + 添加属性
                </button>
              </fieldset>

              <!-- Submit -->
              <div v-if="formError" class="form-message form-message--error">
                {{ formError }}
              </div>
            </div>

            <div class="modal-footer">
              <button
                class="cancel-btn"
                type="button"
                @click="closeCreateModal"
              >
                取消
              </button>
              <button
                class="submit-btn"
                :disabled="isSubmitting"
                @click="handleCreate"
              >
                <span v-if="isSubmitting" class="spinner"></span>
                <span v-else>创建角色</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.oc-list-page {
  padding-block: clamp(32px, 6vw, 64px);
}

/* ─── Header ──────────────────────────────────────────────── */

.page-header {
  margin-bottom: clamp(24px, 4vw, 40px);
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

h1 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 4vw, 2.8rem);
  line-height: 1.12;
}

.back-link {
  display: inline-flex;
  align-items: center;
  margin-top: 14px;
  color: var(--color-muted);
  font-size: 0.9rem;
  font-weight: 700;
  text-decoration: none;
  transition: color 120ms ease;
}

.back-link::before {
  content: '\2190';
  margin-right: 6px;
  font-size: 1.05rem;
}

.back-link:hover {
  color: var(--color-accent);
}

/* ─── Sections ────────────────────────────────────────────── */

.section-title {
  margin: 0 0 18px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 900;
  line-height: 1.3;
}

.section-title--sub {
  font-size: 1rem;
  margin-bottom: 10px;
}

/* ─── Create button ──────────────────────────────────────── */

.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 18px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: #103b31;
  font-size: 0.88rem;
  font-weight: 900;
  cursor: pointer;
  transition: background 150ms ease;
}

.create-btn:hover {
  background: #0e3128;
}

.create-btn:focus-visible {
  outline: 0;
  box-shadow: var(--focus-ring);
}

/* ─── Modal ───────────────────────────────────────────────── */

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(24 33 31 / 50%);
  backdrop-filter: blur(4px);
}

.modal-card {
  width: 100%;
  max-width: 580px;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 24px 80px rgb(24 33 31 / 28%);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--color-line);
}

.modal-title {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 900;
}

.modal-close-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: all 120ms ease;
}

.modal-close-btn:hover {
  background: rgb(24 33 31 / 6%);
  color: var(--color-ink);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-line);
}

/* Modal transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 200ms ease;
}

.modal-enter-active .modal-card,
.modal-leave-active .modal-card {
  transition: transform 200ms ease, opacity 200ms ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-card {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}

.modal-leave-to .modal-card {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}

/* ─── List ────────────────────────────────────────────────── */

.list-section {
  margin-top: clamp(24px, 4vw, 40px);
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.list-header .section-title {
  margin-bottom: 0;
}

/* ─── Form fields ─────────────────────────────────────────── */

.form-grid {
  display: grid;
  gap: 16px;
}

.form-field {
  display: block;
  position: relative;
}

.form-field--wide {
  grid-column: 1 / -1;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  color: var(--color-muted);
  font-size: 0.84rem;
  font-weight: 800;
}

.field-label--compact {
  display: block;
  margin-bottom: 4px;
  color: var(--color-muted);
  font-size: 0.76rem;
  font-weight: 700;
}

.field-required {
  color: #c0392b;
}

.field-input {
  width: 100%;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: #fff;
  color: var(--color-ink);
  font-size: 0.92rem;
  font-family: var(--font-body);
  line-height: 1.5;
  box-sizing: border-box;
  transition: border-color 120ms ease;
}

.field-input:focus {
  outline: 0;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

.field-textarea {
  padding: 10px 12px;
  resize: vertical;
  min-height: 72px;
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

.avatar-upload-field {
  display: grid;
  gap: 8px;
}

.avatar-upload-field--compact {
  margin-bottom: 2px;
}

.avatar-upload {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 58px;
  padding: 8px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 72%);
  color: var(--color-ink);
  cursor: pointer;
  text-align: left;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}

.avatar-upload:hover:not(:disabled) {
  border-color: var(--color-line-strong);
  background: #fff;
}

.avatar-upload:disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.avatar-upload--large {
  min-height: 74px;
}

.avatar-upload__preview {
  display: block;
  width: 42px;
  height: 42px;
  overflow: hidden;
  flex-shrink: 0;
  border-radius: 50%;
  background: #103b31;
}

.avatar-upload__preview--large {
  width: 54px;
  height: 54px;
}

.avatar-upload__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-upload__preview span {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: #fff;
  font-weight: 900;
}

.avatar-upload__copy {
  color: var(--color-muted);
  font-size: 0.86rem;
  font-weight: 800;
}

.char-count {
  position: absolute;
  right: 8px;
  bottom: -18px;
  font-size: 0.72rem;
  color: var(--color-muted);
}

.char-count--warn {
  color: #c0392b;
  font-weight: 700;
}

/* ─── Attributes ──────────────────────────────────────────── */

.attributes-fieldset {
  border: 0;
  padding: 0;
  margin: 18px 0 0;
}

.attributes-fieldset--compact {
  margin-top: 12px;
}

.attr-empty {
  color: var(--color-muted);
  font-size: 0.88rem;
  padding: 10px 0;
}

.attr-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin-bottom: 10px;
}

.attr-row .field-input {
  height: 42px;
}

.attr-key {
  flex: 2;
}

.attr-type {
  flex: 1;
  min-width: 80px;
}

.attr-value {
  flex: 2;
}

.attr-remove-btn {
  flex-shrink: 0;
  width: 38px;
  min-height: 42px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  font-size: 1.1rem;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 120ms ease;
  align-self: flex-end;
  padding: 0;
}

.attr-remove-btn:hover {
  border-color: #c0392b;
  color: #c0392b;
  background: rgb(192 57 43 / 6%);
}

.attr-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: 1px dashed var(--color-line-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--color-accent);
  font-size: 0.84rem;
  font-weight: 800;
  cursor: pointer;
  transition: all 120ms ease;
}

.attr-add-btn:hover {
  background: rgb(20 115 90 / 6%);
  border-color: var(--color-accent);
}

/* ─── Form message ────────────────────────────────────────── */

.form-message {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.5;
}

.form-message--error {
  color: #a1322b;
  background: rgb(192 57 43 / 8%);
}

/* ─── Submit ──────────────────────────────────────────────── */

.submit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 120px;
  min-height: 44px;
  padding: 0 24px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: #103b31;
  font-size: 0.92rem;
  font-weight: 900;
  cursor: pointer;
  transition: background 150ms ease;
}

.submit-btn:hover:not(:disabled) {
  background: #0e3128;
}

.submit-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.submit-btn--compact {
  min-width: unset;
  min-height: 38px;
  padding: 0 18px;
  font-size: 0.86rem;
}

.cancel-btn {
  min-height: 38px;
  padding: 0 18px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  font-size: 0.86rem;
  font-weight: 800;
  cursor: pointer;
  transition: all 120ms ease;
}

.cancel-btn:hover {
  border-color: var(--color-line-strong);
  color: var(--color-ink);
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgb(255 255 255 / 30%);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ─── State panels ────────────────────────────────────────── */

.inline-state {
  padding: 28px 20px;
  border: 2px dashed var(--color-line);
  border-radius: 10px;
  text-align: center;
  color: var(--color-muted);
  font-size: 0.92rem;
  line-height: 1.6;
}

.inline-state--error {
  border-color: rgb(192 57 43 / 24%);
  background: rgb(192 57 43 / 4%);
  color: #a1322b;
}

.state-retry-btn {
  margin-top: 12px;
  padding: 6px 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  font-size: 0.84rem;
  font-weight: 800;
  cursor: pointer;
}

.state-retry-btn:hover {
  border-color: var(--color-ink);
  color: var(--color-ink);
}

/* ─── OC Grid ─────────────────────────────────────────────── */

.oc-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

.oc-card {
  position: relative;
  background: linear-gradient(
    180deg,
    rgb(255 255 255 / 60%),
    rgb(244 240 231 / 30%)
  );
  border: 1px solid rgb(16 59 49 / 10%);
  border-radius: 10px;
  padding: 20px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.oc-card:hover {
  border-color: rgb(20 115 90 / 18%);
  box-shadow: 0 4px 18px rgb(24 33 31 / 6%);
}

.oc-card--editing {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgb(20 115 90 / 10%);
}

.oc-card-top {
  display: flex;
  gap: 12px;
  align-items: center;
}

.oc-avatar {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid rgb(20 115 90 / 14%);
}

.oc-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.oc-avatar-fallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  color: #fff;
  background: #103b31;
  font-size: 0.92rem;
  font-weight: 900;
}

.oc-card-header {
  min-width: 0;
}

.oc-name {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 900;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oc-time {
  display: block;
  margin-top: 2px;
  color: var(--color-muted);
  font-size: 0.74rem;
}

.oc-bio {
  margin: 12px 0 0;
  color: var(--color-muted);
  font-size: 0.88rem;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.oc-attrs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.oc-attr-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgb(232 241 237 / 60%);
  color: #305349;
  font-size: 0.76rem;
  font-weight: 700;
  white-space: nowrap;
}

.oc-edit-btn {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  margin-top: 16px;
  padding: 0 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
  cursor: pointer;
  transition: all 120ms ease;
}

.oc-edit-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

/* ─── Edit form inside card ───────────────────────────────── */

.edit-form-inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.edit-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

/* ─── Responsive ──────────────────────────────────────────── */

@media (max-width: 1024px) {
  .oc-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .oc-grid {
    grid-template-columns: 1fr;
  }

  .attr-row {
    flex-wrap: wrap;
  }

  .attr-key,
  .attr-type,
  .attr-value {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }

  .attr-remove-btn {
    flex: 0 0 32px;
  }
}
</style>
