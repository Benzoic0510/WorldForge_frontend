<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const form = reactive({
  username: '',
  nickname: '',
  email: '',
  verificationCode: '',
  password: '',
  confirmPassword: ''
})

const router = useRouter()
const authStore = useAuthStore()
const isSendingCode = ref(false)
const isSubmitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message
  }
  return '操作失败，请稍后再试'
}

function validateRegisterForm() {
  if (!form.username.trim()) {
    return '请输入用户名'
  }
  if (!form.email.trim()) {
    return '请输入邮箱'
  }
  if (!form.verificationCode.trim()) {
    return '请输入邮箱验证码'
  }
  if (!form.password) {
    return '请输入密码'
  }
  if (!form.confirmPassword) {
    return '请再次输入密码'
  }
  if (form.password !== form.confirmPassword) {
    return '两次输入的密码不一致'
  }
  return ''
}

async function handleSendCode() {
  errorMessage.value = ''
  successMessage.value = ''

  if (!form.email.trim()) {
    errorMessage.value = '请输入邮箱'
    return
  }

  isSendingCode.value = true
  try {
    const result = await authStore.sendEmailCode(form.email.trim())
    successMessage.value = `验证码已发送至 ${result.email}，${result.expiresIn} 秒内有效`
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    isSendingCode.value = false
  }
}

async function handleRegister() {
  errorMessage.value = ''
  successMessage.value = ''

  const validationMessage = validateRegisterForm()
  if (validationMessage) {
    errorMessage.value = validationMessage
    return
  }

  isSubmitting.value = true
  try {
    await authStore.register({
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password,
      nickname: form.nickname.trim(),
      verificationCode: form.verificationCode.trim()
    })
    await router.push({ name: 'login' })
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="register-page">
    <section class="auth-panel" aria-labelledby="register-title">
      <RouterLink class="brand-link" to="/">WorldForge</RouterLink>

      <div class="panel-heading">
        <p class="eyebrow">Join</p>
        <h1 id="register-title">创建账号</h1>
      </div>

      <form class="auth-form" @submit.prevent="handleRegister">
        <label>
          <span>用户名 *</span>
          <input v-model="form.username" autocomplete="username" name="username" type="text">
        </label>

        <label>
          <span class="field-label">
            昵称（选填）
            <small class="field-hint">默认使用用户名作为昵称</small>
          </span>
          <input v-model="form.nickname" autocomplete="nickname" name="nickname" type="text">
        </label>

        <label>
          <span>邮箱 *</span>
          <input v-model="form.email" autocomplete="email" name="email" type="email">
        </label>

        <div class="code-row">
          <label>
            <span>验证码 *</span>
            <input v-model="form.verificationCode" inputmode="numeric" name="verificationCode" type="text">
          </label>
          <button class="code-button" type="button" :disabled="isSendingCode" @click="handleSendCode">
            {{ isSendingCode ? '发送中' : '发送' }}
          </button>
        </div>

        <label>
          <span>密码 *</span>
          <input v-model="form.password" autocomplete="new-password" name="password" type="password">
        </label>

        <label>
          <span>确认密码 *</span>
          <input v-model="form.confirmPassword" autocomplete="new-password" name="confirmPassword" type="password">
        </label>

        <p v-if="errorMessage" class="form-message error" role="alert">{{ errorMessage }}</p>
        <p v-if="successMessage" class="form-message success" role="status">{{ successMessage }}</p>

        <button class="submit-button" type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? '注册中...' : '注册' }}
        </button>
      </form>

      <p class="switch-line">
        已经有账号？
        <RouterLink to="/login">去登录</RouterLink>
      </p>
    </section>
  </main>
</template>

<style scoped>
.register-page {
  min-height: calc(100vh - var(--nav-height));
  display: grid;
  place-items: center;
  width: min(var(--page-max-width), calc(100% - 40px));
  margin-inline: auto;
  padding: clamp(32px, 6vw, 72px) 0;
}

.brand-link {
  display: inline-block;
  color: var(--color-accent);
  font-size: 0.86rem;
  font-weight: 900;
  text-decoration: none;
  text-transform: uppercase;
}

h1 {
  margin: 10px 0 0;
  max-width: 8ch;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(2.15rem, 4vw, 3.5rem);
  line-height: 1.02;
  word-break: keep-all;
  text-wrap: balance;
}

.auth-panel {
  width: min(620px, 100%);
  padding: clamp(24px, 4vw, 40px);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 88%);
  box-shadow: var(--shadow-panel);
}

.panel-heading {
  display: grid;
  gap: 10px;
  margin-bottom: 24px;
}

.eyebrow {
  margin: 0;
  color: var(--color-accent);
  font-size: 0.75rem;
  font-weight: 900;
  text-transform: uppercase;
}

.auth-form {
  display: grid;
  gap: 16px;
}

label {
  display: grid;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.92rem;
  font-weight: 700;
}

.field-label {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
}

.field-hint {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 500;
  line-height: 1.5;
}

input {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: #fff;
  font: inherit;
}

input:focus {
  border-color: var(--color-accent);
  outline: 3px solid rgb(20 115 90 / 14%);
}

.code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 10px;
  align-items: end;
}

button {
  min-height: 46px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: var(--color-ink);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.code-button {
  background: var(--color-accent);
}

.submit-button {
  margin-top: 4px;
}

.switch-line {
  margin: 24px 0 0;
  color: var(--color-muted);
  text-align: center;
}

.switch-line a {
  color: var(--color-accent);
  font-weight: 900;
}

.form-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.form-message.error {
  border: 1px solid rgb(176 64 64 / 28%);
  color: #8f2d2d;
  background: rgb(255 246 242 / 92%);
}

.form-message.success {
  border: 1px solid rgb(20 115 90 / 24%);
  color: var(--color-accent);
  background: rgb(239 250 245 / 92%);
}

@media (max-width: 420px) {
  .code-row {
    grid-template-columns: 1fr;
  }
}
</style>
