<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton } from 'naive-ui'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import { createAuthorizeQrDataUrl, createQrDisplayUrl } from '../utils/qrcode'
import { MessagePlugin } from '../utils/ui'

type ScanStatus = 'idle' | 'pending' | 'scanned' | 'completed' | 'failed' | 'expired'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const qrDisplayUrl = ref('')
const qrContent = ref('')
const qrMode = ref<'dynamic' | 'fixed' | 'fallback' | 'platform' | ''>('')
const state = ref('')
const miniProgramPath = ref('')
const scene = ref('')
const status = ref<ScanStatus>('idle')
const message = ref('点击生成二维码后，用微信扫码并按提示确认登录。')
const completedUser = ref<{ username?: string | null; email?: string | null; id?: string } | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const form = reactive({
  clientId: typeof route.query.client_id === 'string' ? route.query.client_id : '',
  redirectUri: typeof route.query.redirect_uri === 'string' ? route.query.redirect_uri : '',
})

const apiOrigin = computed(() => import.meta.env.VITE_API_BASE_URL || window.location.origin)
const confirmEndpoint = computed(() => `${apiOrigin.value.replace(/\/$/, '')}/api/auth/wechat-mini/login-confirm`)
const statusText = computed(() => {
  const map: Record<ScanStatus, string> = {
    idle: '未开始',
    pending: '等待扫码',
    scanned: '等待确认',
    completed: '已登录',
    failed: '失败',
    expired: '已过期',
  }
  return map[status.value]
})

function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function resetResult() {
  stopPolling()
  qrDisplayUrl.value = ''
  qrContent.value = ''
  qrMode.value = ''
  state.value = ''
  miniProgramPath.value = ''
  scene.value = ''
  status.value = 'idle'
  completedUser.value = null
}

async function generateQr() {
  resetResult()
  loading.value = true
  status.value = 'pending'
  message.value = '正在生成微信扫码会话...'

  try {
    const result = await authApi.createWechatMiniLoginQr(
      form.clientId.trim() || undefined,
      form.redirectUri.trim() || undefined,
    )
    state.value = result.state
    miniProgramPath.value = result.miniProgramPath
    scene.value = result.scene
    qrMode.value = result.qrMode
    qrContent.value = result.qrContent
    qrDisplayUrl.value = await createQrDisplayUrl(result.qrContent, result.qrCodeUrl, {
      width: 280,
      margin: 2,
      dark: '#0f172a',
      light: '#ffffff',
    })
    message.value = '请使用微信扫码，在小程序内确认登录。'

    timer = setInterval(() => {
      void pollStatus()
    }, 1600)
    void pollStatus()
  } catch (error) {
    status.value = 'failed'
    message.value = (error as { message?: string })?.message || '生成二维码失败'
  } finally {
    loading.value = false
  }
}

async function pollStatus() {
  if (!state.value) return

  try {
    const result = await authApi.getWechatMiniLoginStatus(state.value)
    if (result.status === 'completed' && result.ticket) {
      stopPolling()
      status.value = 'completed'
      const auth = await authApi.redeemSocialLoginTicket(result.ticket)
      completedUser.value = {
        id: auth.user.id,
        username: auth.user.username,
        email: auth.user.email,
      }
      authStore.applySession(auth)
      message.value = '微信确认成功，网页端已写入登录会话。'
      return
    }

    if (result.status === 'scanned') {
      status.value = 'pending'
      message.value = '请在小程序内确认登录。'
      return
    }

    if (result.status === 'failed') {
      stopPolling()
      status.value = 'failed'
      message.value = result.error || '微信确认失败'
      return
    }

    if (result.status === 'expired') {
      stopPolling()
      status.value = 'expired'
      message.value = '二维码已过期，请重新生成。'
    }
  } catch (error) {
    stopPolling()
    status.value = 'failed'
    message.value = (error as { message?: string })?.message || '查询扫码状态失败'
  }
}

async function handleImageError() {
  if (!qrContent.value || qrDisplayUrl.value.startsWith('data:image/')) return

  try {
    qrDisplayUrl.value = await createAuthorizeQrDataUrl(qrContent.value, {
      width: 280,
      margin: 2,
      dark: '#0f172a',
      light: '#ffffff',
    })
  } catch {
    status.value = 'failed'
    message.value = '二维码图片加载失败，请重新生成。'
  }
}

async function copyText(value: string, label: string) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    MessagePlugin.success(`${label}已复制`)
  } catch {
    MessagePlugin.warning('浏览器不允许自动复制，请手动复制')
  }
}

function goAccount() {
  void router.push(authStore.user?.role === 'admin' ? '/user/overview' : '/user/account')
}

onMounted(() => {
  void generateQr()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <main class="wechat-test-page">
    <section class="wechat-test-hero">
      <div>
        <p class="eyebrow">Wechat Scan Login</p>
        <h1>微信扫码登录测试</h1>
        <p>
          本页生成认证中心的微信扫码会话并轮询状态。确认页只提交
          <code>state</code> 和 <code>jsCode</code>，无需输入扫码动态码。
        </p>
      </div>
      <div class="hero-status" :data-status="status">
        <span>{{ statusText }}</span>
        <strong>{{ state || '等待生成' }}</strong>
      </div>
    </section>

    <section class="wechat-test-grid">
      <div class="test-card qr-card">
        <div class="qr-frame">
          <img v-if="qrDisplayUrl" :src="qrDisplayUrl" alt="微信扫码登录二维码" @error="handleImageError" />
          <div v-else class="qr-placeholder">
            <span></span>
            <p>{{ loading ? '生成中...' : '暂无二维码' }}</p>
          </div>
        </div>

        <div class="scan-message">
          <strong>{{ message }}</strong>
          <p v-if="qrMode">二维码模式：{{ qrMode }}</p>
        </div>

        <div class="action-row">
          <NButton type="primary" size="large" :loading="loading" @click="generateQr">重新生成</NButton>
          <NButton size="large" :disabled="status !== 'completed'" @click="goAccount">进入用户中心</NButton>
        </div>
      </div>

      <div class="test-card">
        <h2>测试参数</h2>
        <p class="muted">如果只测认证中心扫码登录，下面两项可以留空；如果测某个 OAuth 应用，可填写该应用上下文。</p>

        <label class="form-field">
          <span>Client ID</span>
          <input v-model="form.clientId" placeholder="可选，例如博客系统 OAuth Client ID" />
        </label>
        <label class="form-field">
          <span>Redirect URI</span>
          <input v-model="form.redirectUri" placeholder="可选，例如 http://localhost:3256/auth/callback" />
        </label>

        <div class="info-list">
          <div>
            <span>确认接口</span>
            <button type="button" @click="copyText(confirmEndpoint, '确认接口')">{{ confirmEndpoint }}</button>
          </div>
          <div>
            <span>小程序路径</span>
            <button type="button" @click="copyText(miniProgramPath, '小程序路径')">{{ miniProgramPath || '-' }}</button>
          </div>
          <div>
            <span>Scene</span>
            <button type="button" @click="copyText(scene, 'Scene')">{{ scene || '-' }}</button>
          </div>
          <div>
            <span>State</span>
            <button type="button" @click="copyText(state, 'State')">{{ state || '-' }}</button>
          </div>
        </div>

        <div v-if="completedUser" class="success-box">
          <strong>已登录</strong>
          <p>{{ completedUser.username || completedUser.email || completedUser.id }}</p>
        </div>
      </div>
    </section>

    <section class="test-card notes-card">
      <h2>小程序端回调规则</h2>
      <p>
        微信开发者工具打开对应小程序项目后，可直接编译
        <code>pages/sso-login/sso-login</code>，query 填入本页生成的 <code>state</code>。
        真机扫动态小程序码时，需要上传包含该页面的小程序开发版/体验版。
      </p>
    </section>
  </main>
</template>

<style scoped>
.wechat-test-page {
  width: min(1120px, calc(100vw - 32px));
  padding: 64px 0 48px;
}

.wechat-test-hero,
.test-card {
  border: 1px solid rgba(15, 23, 42, 0.10);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.10);
  backdrop-filter: blur(18px);
}

:global(:root[data-app-theme='dark']) .wechat-test-hero,
:global(:root[data-app-theme='dark']) .test-card {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.82);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34);
}

.wechat-test-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  padding: 34px;
}

.eyebrow {
  margin: 0 0 12px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.wechat-test-hero h1 {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(32px, 5vw, 58px);
  font-weight: 950;
  letter-spacing: -0.08em;
}

.wechat-test-hero p {
  max-width: 680px;
  margin: 16px 0 0;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1.8;
}

code {
  border-radius: 8px;
  background: rgba(47, 125, 255, 0.10);
  color: var(--accent);
  padding: 2px 6px;
  font-size: 0.9em;
}

.hero-status {
  display: grid;
  min-width: 220px;
  gap: 8px;
  border-radius: 22px;
  background: linear-gradient(135deg, #0f172a, #1e40af);
  color: #fff;
  padding: 20px;
}

.hero-status[data-status='completed'] {
  background: linear-gradient(135deg, #047857, #10b981);
}

.hero-status[data-status='failed'],
.hero-status[data-status='expired'] {
  background: linear-gradient(135deg, #991b1b, #ef4444);
}

.hero-status span {
  font-size: 12px;
  font-weight: 900;
  opacity: 0.78;
}

.hero-status strong {
  overflow-wrap: anywhere;
  font-size: 15px;
}

.wechat-test-grid {
  display: grid;
  grid-template-columns: minmax(320px, 420px) 1fr;
  gap: 24px;
  margin-top: 24px;
}

.test-card {
  padding: 28px;
}

.qr-card {
  text-align: center;
}

.qr-frame {
  display: grid;
  width: 310px;
  height: 310px;
  place-items: center;
  margin: 0 auto;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 34px;
  background: linear-gradient(145deg, #ffffff, #eff6ff);
}

.qr-frame img {
  width: 280px;
  height: 280px;
  border-radius: 24px;
  object-fit: contain;
}

.qr-placeholder {
  display: grid;
  place-items: center;
  gap: 14px;
  color: var(--text-muted);
}

.qr-placeholder span {
  width: 44px;
  height: 44px;
  border: 3px solid rgba(47, 125, 255, 0.18);
  border-top-color: var(--accent);
  border-radius: 999px;
  animation: spin 0.9s linear infinite;
}

.scan-message {
  margin: 22px 0;
  color: var(--text-primary);
}

.scan-message strong {
  display: block;
  line-height: 1.7;
}

.scan-message p,
.muted,
.notes-card p {
  color: var(--text-muted);
  line-height: 1.8;
}

.action-row {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.test-card h2 {
  margin: 0 0 10px;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 900;
}

.form-field {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.form-field span,
.info-list span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 900;
}

.form-field input {
  width: 100%;
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  background: var(--surface-primary);
  color: var(--text-primary);
  padding: 13px 15px;
  outline: none;
}

.form-field input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px rgba(47, 125, 255, 0.12);
}

.info-list {
  display: grid;
  gap: 12px;
  margin-top: 24px;
}

.info-list div {
  display: grid;
  gap: 6px;
  border-radius: 16px;
  background: var(--surface-primary);
  padding: 12px;
}

.info-list button {
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0;
  text-align: left;
  word-break: break-all;
}

.success-box {
  margin-top: 20px;
  border-radius: 18px;
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
  padding: 16px;
}

.success-box p {
  margin: 6px 0 0;
}

.notes-card {
  margin-top: 24px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 860px) {
  .wechat-test-hero,
  .wechat-test-grid {
    grid-template-columns: 1fr;
  }

  .wechat-test-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .qr-frame {
    width: min(100%, 310px);
  }
}
</style>
