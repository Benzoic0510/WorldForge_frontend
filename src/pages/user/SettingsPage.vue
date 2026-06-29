<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { deleteCurrentUser, uploadCurrentUserAvatar } from '@/api/user'

interface ProfileForm {
  nickname: string
  bio: string
}

interface PasswordForm {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const authStore = useAuthStore()
const router = useRouter()

const currentUser = computed(() => authStore.currentUser)

// 个人资料表单
const profileForm = reactive<ProfileForm>({
  nickname: currentUser.value?.nickname || '',
  bio: currentUser.value?.bio || ''
})
const profileSubmitting = ref(false)
const profileMessage = ref('')
const profileIsError = ref(false)
const avatarFileInput = ref<HTMLInputElement | null>(null)
const avatarPreviewUrl = ref('')
const avatarImageFailed = ref(false)
const avatarUploading = ref(false)

// 密码表单
const passwordForm = reactive<PasswordForm>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const passwordSubmitting = ref(false)
const passwordMessage = ref('')
const passwordIsError = ref(false)
const deletingAccount = ref(false)
const deleteMessage = ref('')

const displayName = computed(() => currentUser.value?.nickname || currentUser.value?.username || '用户')

const avatarSrc = computed(() => {
  if (avatarPreviewUrl.value) {
    return avatarPreviewUrl.value
  }
  if (avatarImageFailed.value) {
    return null
  }
  const url = currentUser.value?.avatarUrl
  return url && url.length > 0 ? url : null
})

const initialLetter = computed(() => displayName.value.charAt(0))

function validateProfileForm(): string {
  if (!profileForm.nickname.trim()) {
    return '昵称不能为空'
  }
  if (profileForm.nickname.trim().length > 30) {
    return '昵称不能超过 30 个字符'
  }
  if (profileForm.bio && profileForm.bio.length > 200) {
    return '个人简介不能超过 200 个字符'
  }
  return ''
}

function validatePasswordForm(): string {
  if (!passwordForm.currentPassword) {
    return '请输入当前密码'
  }
  if (!passwordForm.newPassword) {
    return '请输入新密码'
  }
  if (passwordForm.newPassword.length < 6) {
    return '新密码长度不能少于 6 个字符'
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    return '两次输入的密码不一致'
  }
  return ''
}

async function handleSaveProfile() {
  profileMessage.value = ''
  profileIsError.value = false

  const error = validateProfileForm()
  if (error) {
    profileMessage.value = error
    profileIsError.value = true
    return
  }

  profileSubmitting.value = true
  // TODO: 调用后端 API 保存个人资料
  // await updateProfile({ nickname: profileForm.nickname.trim(), bio: profileForm.bio })
  await new Promise((resolve) => setTimeout(resolve, 600))
  profileMessage.value = '个人资料已保存'
  profileIsError.value = false
  profileSubmitting.value = false
}

async function handleChangePassword() {
  passwordMessage.value = ''
  passwordIsError.value = false

  const error = validatePasswordForm()
  if (error) {
    passwordMessage.value = error
    passwordIsError.value = true
    return
  }

  passwordSubmitting.value = true
  // TODO: 调用后端 API 修改密码
  // await changePassword({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword })
  await new Promise((resolve) => setTimeout(resolve, 600))
  passwordMessage.value = '密码已修改'
  passwordIsError.value = false
  passwordForm.currentPassword = ''
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  passwordSubmitting.value = false
}

function handleAvatarClick() {
  if (!avatarUploading.value) {
    avatarFileInput.value?.click()
  }
}

function revokeAvatarPreview() {
  if (avatarPreviewUrl.value) {
    URL.revokeObjectURL(avatarPreviewUrl.value)
    avatarPreviewUrl.value = ''
  }
}

async function handleAvatarSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  if (!file || avatarUploading.value) {
    return
  }

  profileMessage.value = ''
  profileIsError.value = false
  avatarImageFailed.value = false

  if (file.size > 5 * 1024 * 1024) {
    profileMessage.value = '头像图片最多 5MB'
    profileIsError.value = true
    input.value = ''
    return
  }

  revokeAvatarPreview()
  avatarPreviewUrl.value = URL.createObjectURL(file)
  avatarUploading.value = true
  try {
    const uploaded = await uploadCurrentUserAvatar(file)
    await authStore.fetchCurrentUser()
    revokeAvatarPreview()
    if (authStore.currentUser) {
      authStore.currentUser.avatarUrl = uploaded.url
    }
    profileMessage.value = '头像已更新'
    profileIsError.value = false
  } catch (err: any) {
    profileMessage.value = err?.message || '头像上传失败，请稍后重试'
    profileIsError.value = true
    revokeAvatarPreview()
  } finally {
    avatarUploading.value = false
    input.value = ''
  }
}

async function handleDeleteAccount() {
  if (deletingAccount.value) return
  const confirmed = window.confirm('确定要注销当前账号吗？账号删除后无法恢复。')
  if (!confirmed) return

  deletingAccount.value = true
  deleteMessage.value = ''
  try {
    await deleteCurrentUser()
    authStore.clearSession()
    await router.push({ name: 'home' })
  } catch (error) {
    deleteMessage.value = error instanceof ApiError ? error.message : '账号注销失败，请稍后重试'
  } finally {
    deletingAccount.value = false
  }
}

onBeforeUnmount(() => {
  revokeAvatarPreview()
})
</script>

<template>
  <main class="settings-page page-container">
    <section class="settings-heading">
      <p class="eyebrow">Settings</p>
      <h1>设置</h1>
      <p class="lead">管理你的个人资料和账户安全</p>
    </section>

    <!-- 个人资料 -->
    <section class="settings-section">
      <div class="section-heading">
        <h2>个人资料</h2>
        <p class="section-desc">编辑你的公开信息</p>
      </div>

      <form class="settings-form" @submit.prevent="handleSaveProfile">
        <!-- 头像 -->
        <div class="form-group form-group--avatar">
          <label class="form-label">头像</label>
          <div class="avatar-row">
            <div class="avatar-preview" @click="handleAvatarClick" title="点击更换头像">
              <img v-if="avatarSrc" :src="avatarSrc" alt="" @error="avatarImageFailed = true" />
              <span v-else class="avatar-initial">{{ initialLetter }}</span>
              <div class="avatar-overlay">{{ avatarUploading ? '上传中' : '更换' }}</div>
            </div>
            <input
              ref="avatarFileInput"
              accept="image/jpeg,image/png,image/webp,image/gif"
              class="visually-hidden"
              type="file"
              @change="handleAvatarSelected"
            >
            <span class="avatar-hint">
              {{ avatarUploading ? '头像上传中...' : '点击头像更换，支持 JPG、PNG、WebP、GIF，最多 5MB' }}
            </span>
          </div>
        </div>

        <!-- 昵称 -->
        <div class="form-group">
          <label class="form-label" for="profile-nickname">昵称</label>
          <input
            id="profile-nickname"
            v-model="profileForm.nickname"
            type="text"
            maxlength="30"
            placeholder="输入昵称"
          />
        </div>

        <!-- 个人简介 -->
        <div class="form-group">
          <label class="form-label" for="profile-bio">个人简介</label>
          <textarea
            id="profile-bio"
            v-model="profileForm.bio"
            maxlength="200"
            placeholder="介绍一下你自己..."
            rows="3"
          ></textarea>
          <span class="char-count">{{ profileForm.bio ? profileForm.bio.length : 0 }}/200</span>
        </div>

        <p v-if="profileMessage" class="form-message" :class="{ 'form-message--error': profileIsError }">
          {{ profileMessage }}
        </p>

        <button type="submit" :disabled="profileSubmitting" class="submit-btn">
          {{ profileSubmitting ? '保存中...' : '保存更改' }}
        </button>
      </form>
    </section>

    <!-- 安全 -->
    <section class="settings-section">
      <div class="section-heading">
        <h2>安全</h2>
        <p class="section-desc">修改登录密码</p>
      </div>

      <form class="settings-form" @submit.prevent="handleChangePassword">
        <div class="form-group">
          <label class="form-label" for="current-password">当前密码</label>
          <input
            id="current-password"
            v-model="passwordForm.currentPassword"
            type="password"
            autocomplete="current-password"
            placeholder="输入当前密码"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="new-password">新密码</label>
          <input
            id="new-password"
            v-model="passwordForm.newPassword"
            type="password"
            autocomplete="new-password"
            placeholder="输入新密码（至少 6 个字符）"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="confirm-password">确认新密码</label>
          <input
            id="confirm-password"
            v-model="passwordForm.confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="再次输入新密码"
          />
        </div>

        <p v-if="passwordMessage" class="form-message" :class="{ 'form-message--error': passwordIsError }">
          {{ passwordMessage }}
        </p>

        <button type="submit" :disabled="passwordSubmitting" class="submit-btn">
          {{ passwordSubmitting ? '修改中...' : '修改密码' }}
        </button>
      </form>
    </section>

    <!-- 危险操作 -->
    <section class="settings-section settings-section--danger">
      <div class="section-heading">
        <h2>危险操作</h2>
        <p class="section-desc">删除账号后，所有数据将被永久清除且不可恢复</p>
      </div>

      <p v-if="deleteMessage" class="form-message form-message--error">
        {{ deleteMessage }}
      </p>

      <button type="button" class="danger-btn" :disabled="deletingAccount" @click="handleDeleteAccount">
        {{ deletingAccount ? '注销中...' : '删除账号' }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.settings-page {
  padding-block: clamp(28px, 4vw, 48px) 64px;
  max-width: 680px;
}

.settings-heading {
  margin-bottom: 36px;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.12;
}

.lead {
  margin: 12px 0 0;
  color: var(--color-muted);
  font-size: 1rem;
}

/* --- 分区 --- */
.settings-section {
  padding: 28px;
  margin-bottom: 20px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 58%);
}

.settings-section--danger {
  border-color: rgb(176 64 64 / 22%);
  background: rgb(255 250 248 / 58%);
}

.section-heading {
  margin-bottom: 22px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-line);
}

.section-heading h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.32rem;
}

.section-desc {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 0.9rem;
}

/* --- 表单 --- */
.settings-form {
  display: grid;
  gap: 18px;
}

.form-group {
  display: grid;
  gap: 8px;
}

.form-label {
  color: var(--color-muted);
  font-size: 0.9rem;
  font-weight: 700;
}

.form-group--avatar {
  align-items: start;
}

input,
textarea {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: #fff;
  font: inherit;
}

textarea {
  padding: 10px 12px;
  min-height: 88px;
  resize: vertical;
}

input:focus,
textarea:focus {
  border-color: var(--color-accent);
  outline: 3px solid rgb(20 115 90 / 14%);
}

.char-count {
  justify-self: end;
  color: var(--color-muted);
  font-size: 0.78rem;
  margin-top: -6px;
}

/* 头像 */
.avatar-row {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.avatar-preview {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-cool);
  cursor: pointer;
}

.avatar-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-initial {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: #fff;
  background: #103b31;
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 900;
}

.avatar-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 42%);
  color: #fff;
  font-size: 0.84rem;
  font-weight: 800;
  opacity: 0;
  transition: opacity 150ms ease;
}

.avatar-preview:hover .avatar-overlay {
  opacity: 1;
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

.avatar-hint {
  color: var(--color-muted);
  font-size: 0.84rem;
}

/* 消息 */
.form-message {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgb(20 115 90 / 28%);
  border-radius: 8px;
  color: var(--color-accent);
  background: rgb(232 241 237 / 72%);
  font-size: 0.9rem;
  font-weight: 700;
}

.form-message--error {
  border-color: rgb(176 64 64 / 28%);
  color: #8f2d2d;
  background: rgb(255 246 242 / 92%);
}

/* 按钮 */
.submit-btn {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 22px;
  margin-top: 2px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: var(--color-ink);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.submit-btn:disabled {
  cursor: wait;
  opacity: 0.68;
}

.danger-btn {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 22px;
  border: 1px solid rgb(176 64 64 / 24%);
  border-radius: 8px;
  color: #8f2d2d;
  background: transparent;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.danger-btn:disabled {
  cursor: wait;
  opacity: 0.68;
}

@media (max-width: 640px) {
  .settings-page {
    max-width: 100%;
  }

  .settings-section {
    padding: 20px;
  }

  .avatar-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .submit-btn {
    width: 100%;
  }
}
</style>
