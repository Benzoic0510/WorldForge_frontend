<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const form = reactive({
  credential: '',
  password: ''
})

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const isSubmitting = ref(false)
const errorMessage = ref('')

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message
  }
  return '登录失败，请稍后再试'
}

function validateLoginForm() {
  if (!form.credential.trim()) {
    return '请输入用户名或邮箱'
  }
  if (!form.password) {
    return '请输入密码'
  }
  return ''
}

function getSafeRedirectPath() {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect
  }
  return ''
}

async function handleLogin() {
  errorMessage.value = ''

  const validationMessage = validateLoginForm()
  if (validationMessage) {
    errorMessage.value = validationMessage
    return
  }

  isSubmitting.value = true
  try {
    await authStore.login({
      credential: form.credential.trim(),
      password: form.password
    })
    const redirectPath = getSafeRedirectPath()
    await router.push(redirectPath || { name: 'home' })
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-copy">
      <RouterLink class="brand-link" to="/">WorldForge</RouterLink>
      <h1>回到你的创作宇宙</h1>
      <p>
        登录后继续维护世界观、追踪提案状态，并进入你的 RPG 角色与协作频道。
      </p>
    </section>

    <section class="auth-panel" aria-labelledby="login-title">
      <div class="panel-heading">
        <p class="eyebrow">Account</p>
        <h2 id="login-title">登录</h2>
      </div>

      <form class="auth-form" @submit.prevent="handleLogin">
        <label>
          <span>用户名或邮箱</span>
          <input v-model="form.credential" autocomplete="username" name="credential" type="text">
        </label>

        <label>
          <span>密码</span>
          <input v-model="form.password" autocomplete="current-password" name="password" type="password">
        </label>

        <p v-if="errorMessage" class="form-message" role="alert">{{ errorMessage }}</p>

        <button type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? '登录中...' : '登录' }}
        </button>
      </form>

      <p class="switch-line">
        还没有账号？
        <RouterLink to="/register">去注册</RouterLink>
      </p>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: calc(100vh - var(--nav-height));
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: clamp(28px, 6vw, 88px);
  align-items: center;
  width: min(var(--page-max-width), calc(100% - 40px));
  margin-inline: auto;
  padding: clamp(32px, 6vw, 72px) 0;
}

.auth-copy {
  max-width: 720px;
}

.brand-link {
  color: var(--color-accent);
  font-size: 0.86rem;
  font-weight: 900;
  text-decoration: none;
  text-transform: uppercase;
}

h1 {
  margin: 22px 0 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  max-width: 10ch;
  font-size: clamp(2.15rem, 4.8vw, 4.6rem);
  line-height: 1.02;
  word-break: keep-all;
  text-wrap: balance;
}

.auth-copy p {
  max-width: 760px;
  margin: 24px 0 0;
  color: var(--color-muted);
  font-size: 1.08rem;
  line-height: 1.85;
  white-space: nowrap;
}

.auth-panel {
  padding: 28px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 88%);
  box-shadow: var(--shadow-panel);
}

.panel-heading {
  margin-bottom: 24px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--color-accent);
  font-size: 0.75rem;
  font-weight: 900;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 2rem;
}

.auth-form {
  display: grid;
  gap: 18px;
}

label {
  display: grid;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.92rem;
  font-weight: 700;
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

button {
  min-height: 46px;
  margin-top: 4px;
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

.form-message {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgb(176 64 64 / 28%);
  border-radius: 8px;
  color: #8f2d2d;
  background: rgb(255 246 242 / 92%);
  font-size: 0.9rem;
}

.switch-line {
  margin: 20px 0 0;
  color: var(--color-muted);
}

.switch-line a {
  color: var(--color-accent);
  font-weight: 900;
}

@media (max-width: 760px) {
  .auth-page {
    grid-template-columns: 1fr;
    padding-top: 28px;
  }

  .auth-copy p {
    white-space: normal;
  }
}
</style>
