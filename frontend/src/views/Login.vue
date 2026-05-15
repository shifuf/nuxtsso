<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { authApi } from '../api/auth'
import { oauthApi } from '../api/oauth'
import { useAuthStore } from '../stores/auth'
import { createAuthorizeQrDataUrl, createQrDisplayUrl } from '../utils/qrcode'
import type { AuthorizeContext } from '../types/api'
import StatusTag from '../components/StatusTag.vue'

type AuthMode = 'password' | 'email' | 'register' | 'reset' | 'authorize' | 'restricted'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const mode = ref<AuthMode>('password')
const submitting = ref(false)
const sendingCode = ref(false)
const socialQrVisible = ref(false)
const socialQrProvider = ref('')
const socialQrUrl = ref('')
const socialQrDisplayUrl = ref('')
const socialQrState = ref('')
const socialQrStatus = ref<'idle' | 'pending' | 'success' | 'failed' | 'expired'>('idle')
const socialQrMessage = ref('')
let socialQrTimer: ReturnType<typeof setInterval> | null = null
const socialQrOptions = {
  width: 230,
  margin: 2,
  dark: '#111827',
  light: '#ffffff',
}

const oauthCtx = ref<AuthorizeContext | null>(null)
const socialProviders = ref<Array<{ name: string; enabled: boolean }>>([])
const requireEmailVerification = ref(true)

const credentialsForm = reactive({ account: '', password: '' })
const emailForm = reactive({ email: '', code: '' })
const registerForm = reactive({ email: '', code: '', username: '', password: '', confirmPassword: '' })
const resetForm = reactive({ email: '', code: '', password: '' })

const clientId = computed(() => route.query.client_id as string | undefined)
const redirectUri = computed(() => route.query.redirect_uri as string | undefined)
const hasOAuthContext = computed(() => Boolean(clientId.value && redirectUri.value))

const showEmailTab = computed(() => requireEmailVerification.value)
const showRegisterTab = computed(() => hasOAuthContext.value && oauthCtx.value?.allowRegistration === true)
const showResetTab = computed(() => requireEmailVerification.value)
const showAuthorizeTab = computed(() => authStore.isAuthenticated && hasOAuthContext.value)
const isAuthorizeOnly = computed(() => authStore.isAuthenticated && hasOAuthContext.value && oauthCtx.value)

const enabledProviders = computed(() =>
  socialProviders.value.filter(p => p.enabled)
)

const titleMap: Record<AuthMode, string> = {
  password: '统一登录', email: '邮箱验证码登录', register: '从接入应用注册',
  reset: '找回密码', authorize: '授权确认', restricted: '访问受限',
}

const descriptionMap: Record<AuthMode, string> = {
  password: '支持用户名或邮箱登录，完成后根据角色进入控制台或继续 OAuth 授权。',
  email: '适用于已开启邮箱验证的场景，发送验证码后完成快速登录。',
  register: '仅在应用允许注册且从授权链路进入时展示。',
  reset: '通过邮箱验证码确认身份后，重置新的登录密码。',
  authorize: '用户认证已完成，请确认是否授权业务系统访问所请求的 Scope。',
  restricted: '应用上下文校验失败，请检查 client_id 与 redirect_uri。',
}

const primaryActionLabel = computed(() => {
  const map: Record<string, string> = { email: '登录并继续', register: '完成注册', reset: '重置密码', authorize: '允许授权', restricted: '返回登录页' }
  return map[mode.value] || '登录'
})

// ── SVG icons for social providers ──
const providerSvg = (name: string): string => {
  const icons: Record<string, string> = {
    wechat: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM12 2C6.48 2 2 6.06 2 10.97c0 2.76 1.48 5.24 3.8 6.85l-.95 2.86 3.27-1.63c1.18.34 2.45.52 3.78.52.35 0 .7-.02 1.04-.05A6.98 6.98 0 0 1 12 16c-3.87 0-7-2.76-7-6.5S8.13 3 12 3s7 2.76 7 6.5c0 .24-.02.48-.05.72A4.99 4.99 0 0 1 22 14c0 2.76-2.24 5-5 5-.55 0-1.08-.1-1.58-.26C13.87 20.5 13 22 12 22c-1.78 0-3.43-.47-4.85-1.28l-4.14 2.07.66-4.01C2.18 17.43 1 15.54 1 13.5 1 10.02 3.78 7.08 7.3 6.03A8.97 8.97 0 0 1 12 2z"/></svg>`,
    github: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`,
    google: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
    qq: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15.19-.36.3-.6.3-.26 0-.5-.12-.64-.33a6.04 6.04 0 0 0-1.8-1.57c-.47-.28-1.01-.48-1.6-.59V5.5h1.25a.75.75 0 1 0 0-1.5h-4a.75.75 0 0 0 0 1.5H10v1.11a4.97 4.97 0 0 0-3.4 2.49c-.15.2-.37.33-.63.33-.15 0-.3-.05-.43-.14-.33-.24-.4-.71-.16-1.04a6.47 6.47 0 0 1 4.62-2.82V5.5h-.75a.75.75 0 1 0 0 1.5H10v.62c1.15.2 2.22.72 3.05 1.5.14.15.19.35.14.53a.48.48 0 0 1-.47.35.48.48 0 0 1-.46-.35.39.39 0 0 0-.38-.27c-.22 0-.38.18-.38.4 0 .04 0 .08.02.11l.03.08c.13.29.44.48.78.48.31 0 .58-.17.72-.43.2-.36.07-.8-.28-1.01-.6-.36-1.3-.56-2.02-.56-1.95 0-3.54 1.6-3.54 3.56 0 1.96 1.59 3.54 3.54 3.54.72 0 1.42-.22 2.02-.6.35-.22.48-.66.27-1.01a.82.82 0 0 0-.72-.43c-.34 0-.65.2-.78.48l-.03.08a.08.08 0 0 1-.02.1c0 .23-.16.4-.38.4-.2 0-.38-.17-.38-.38 0-.1.05-.2.14-.26z"/></svg>`,
    alipay: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.5 6.8c.68 0 1.23.55 1.23 1.23s-.55 1.23-1.23 1.23-1.23-.55-1.23-1.23.55-1.23 1.23-1.23zm-9 0c.68 0 1.23.55 1.23 1.23s-.55 1.23-1.23 1.23-1.23-.55-1.23-1.23.55-1.23 1.23-1.23zm3.5 8.2c-2.5 0-4.5-1.5-4.5-3.5s2-3.5 4.5-3.5 4.5 1.5 4.5 3.5-2 3.5-4.5 3.5z"/></svg>`,
    weibo: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.5 14.5c-2.5 0-4.5-2-4.5-4.5s2-4.5 4.5-4.5 4.5 2 4.5 4.5-2 4.5-4.5 4.5zm5.5-3c-.5 0-1-.5-1-1s.5-1 1-1 1 .5 1 1-.5 1-1 1zm2 4c-1.5 1-3.5 1.5-5.5 1.5-3 0-5.5-1-7.5-2.5-.5-.5-1 0-.5.5 1.5 2 4.5 3.5 8 3.5 2.5 0 5-.5 7-1.5.5-.5 0-1-.5-1z"/></svg>`,
    baidu: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="12" font-weight="bold" fill="white">B</text></svg>`,
    huawei: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="10" font-weight="bold" fill="white">H</text></svg>`,
    xiaomi: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="10" font-weight="bold" fill="white">MI</text></svg>`,
    douyin: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="10" font-weight="bold" fill="white">DY</text></svg>`,
    bilibili: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="10" font-weight="bold" fill="white">B</text></svg>`,
    dingtalk: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="10" font-weight="bold" fill="white">D</text></svg>`,
  }
  return icons[name] ?? `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="10" font-weight="bold" fill="white">${name[0]?.toUpperCase() ?? '?'}</text></svg>`
}

const providerLabel = (name: string): string => {
  const labels: Record<string, string> = {
    wechat: '微信', qq: 'QQ', github: 'GitHub', google: 'Google',
    alipay: '支付宝', weibo: '微博', baidu: '百度',
    huawei: '华为', xiaomi: '小米', douyin: '抖音',
    bilibili: 'B站', dingtalk: '钉钉',
  }
  return labels[name] ?? name
}

// ── Load context ──
async function loadOAuthContext() {
  if (!hasOAuthContext.value) return
  try {
    oauthCtx.value = await oauthApi.getAuthorizeContext({
      client_id: clientId.value, redirect_uri: redirectUri.value,
      scope: route.query.scope as string | undefined, state: route.query.state as string | undefined,
    })
    if (authStore.isAuthenticated) mode.value = 'authorize'
  } catch { mode.value = 'restricted' }
}

async function loadSocialProviders() {
  try { socialProviders.value = await authApi.getSocialProviders(clientId.value) } catch { /* silent */ }
}

async function loadPublicConfig() {
  try {
    const config = await authApi.getPublicConfig()
    requireEmailVerification.value = config.requireEmailVerification
  } catch { /* keep default true */ }
}

onMounted(async () => {
  await Promise.all([loadOAuthContext(), loadSocialProviders(), loadPublicConfig()])
})

onUnmounted(() => {
  stopSocialQrPolling()
})

async function handleSendCode(type: 'login' | 'register' | 'reset-password') {
  const email = type === 'login' ? emailForm.email : type === 'register' ? registerForm.email : resetForm.email
  if (!email) return MessagePlugin.warning('请输入邮箱地址')
  sendingCode.value = true
  try {
    await authApi.sendEmailCode({ email, type, clientId: clientId.value, redirectUri: redirectUri.value })
    MessagePlugin.success('验证码已发送，请查收邮箱')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '发送失败') }
  finally { sendingCode.value = false }
}

async function handlePasswordLogin() {
  if (!credentialsForm.account || !credentialsForm.password) return MessagePlugin.warning('请输入用户名和密码')
  submitting.value = true
  try {
    const res = await authApi.login({ username: credentialsForm.account, password: credentialsForm.password })
    authStore.applySession(res)
    afterLoginSuccess(res.user.role)
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '登录失败') }
  finally { submitting.value = false }
}

async function handleEmailLogin() {
  if (!emailForm.email || !emailForm.code) return MessagePlugin.warning('请输入邮箱和验证码')
  submitting.value = true
  try {
    const res = await authApi.loginEmail({ email: emailForm.email, code: emailForm.code, clientId: clientId.value, redirectUri: redirectUri.value })
    authStore.applySession(res)
    afterLoginSuccess(res.user.role)
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '登录失败') }
  finally { submitting.value = false }
}

async function handleRegister() {
  if (requireEmailVerification.value) {
    if (!registerForm.email || !registerForm.code) return MessagePlugin.warning('请填写邮箱和验证码')
  }
  if (!registerForm.username || !registerForm.password) return MessagePlugin.warning('请填写用户名和密码')
  if (registerForm.password !== registerForm.confirmPassword) return MessagePlugin.warning('两次密码输入不一致')
  submitting.value = true
  try {
    const res = await authApi.register({
      email: registerForm.email || undefined,
      code: registerForm.code || undefined,
      username: registerForm.username,
      password: registerForm.password,
      clientId: clientId.value || '',
      redirectUri: redirectUri.value || '',
    })
    authStore.applySession(res)
    afterLoginSuccess(res.user.role)
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '注册失败') }
  finally { submitting.value = false }
}

async function handleResetPassword() {
  if (!resetForm.email || !resetForm.code || !resetForm.password) return MessagePlugin.warning('请填写所有必填项')
  submitting.value = true
  try {
    await authApi.resetPassword({ email: resetForm.email, code: resetForm.code, newPassword: resetForm.password })
    MessagePlugin.success('密码重置成功')
    mode.value = 'password'
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '重置失败') }
  finally { submitting.value = false }
}

async function handleAuthorize(decision: 'approve' | 'deny') {
  if (!clientId.value || !redirectUri.value) return
  submitting.value = true
  try {
    const result = await oauthApi.authorize({
      client_id: clientId.value, redirect_uri: redirectUri.value,
      scope: route.query.scope as string | undefined, state: route.query.state as string | undefined,
      decision,
    })
    if (result.redirectTo) window.location.href = result.redirectTo
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '操作失败') }
  finally { submitting.value = false }
}

function stopSocialQrPolling() {
  if (socialQrTimer) {
    clearInterval(socialQrTimer)
    socialQrTimer = null
  }
}

function resetSocialQr() {
  stopSocialQrPolling()
  socialQrProvider.value = ''
  socialQrUrl.value = ''
  socialQrDisplayUrl.value = ''
  socialQrState.value = ''
  socialQrStatus.value = 'idle'
  socialQrMessage.value = ''
}

async function handleSocialLogin(provider: string) {
  resetSocialQr()
  socialQrVisible.value = true
  socialQrProvider.value = provider
  socialQrStatus.value = 'pending'
  socialQrMessage.value = '正在生成授权二维码...'

  try {
    const result = await authApi.createSocialLoginQr(provider, clientId.value, redirectUri.value)
    socialQrUrl.value = result.authorizeUrl
    socialQrState.value = result.state
    socialQrMessage.value = '等待扫码/授权'
    socialQrDisplayUrl.value = await createQrDisplayUrl(
      socialQrUrl.value,
      result.qrCodeUrl,
      socialQrOptions,
    )

    socialQrTimer = setInterval(() => {
      void checkSocialLoginStatus()
    }, 1800)
    void checkSocialLoginStatus()
  } catch (e: unknown) {
    socialQrStatus.value = 'failed'
    socialQrMessage.value = (e as { message?: string })?.message || '生成二维码失败'
  }
}

async function handleSocialQrImageError() {
  if (!socialQrUrl.value || socialQrDisplayUrl.value.startsWith('data:image/')) return

  try {
    socialQrDisplayUrl.value = await createAuthorizeQrDataUrl(socialQrUrl.value, socialQrOptions)
  } catch {
    socialQrStatus.value = 'failed'
    socialQrMessage.value = '二维码图片加载失败，请重新生成'
  }
}

async function checkSocialLoginStatus() {
  if (!socialQrState.value) return

  try {
    const result = await authApi.getSocialLoginStatus(socialQrState.value)
    if (result.status === 'completed' && result.auth) {
      stopSocialQrPolling()
      socialQrStatus.value = 'success'
      socialQrMessage.value = '授权成功，正在进入系统...'
      authStore.applySession(result.auth)
      setTimeout(() => {
        socialQrVisible.value = false
        afterLoginSuccess(result.auth!.user.role)
        resetSocialQr()
      }, 800)
      return
    }

    if (result.status === 'failed') {
      stopSocialQrPolling()
      socialQrStatus.value = 'failed'
      socialQrMessage.value = result.error || '第三方授权失败'
      return
    }

    if (result.status === 'expired') {
      stopSocialQrPolling()
      socialQrStatus.value = 'expired'
      socialQrMessage.value = '二维码已过期，请重新发起扫码登录'
    }
  } catch (e: unknown) {
    stopSocialQrPolling()
    socialQrStatus.value = 'failed'
    socialQrMessage.value = (e as { message?: string })?.message || '查询扫码状态失败'
  }
}

function afterLoginSuccess(role: string) {
  if (hasOAuthContext.value) { mode.value = 'authorize' }
  else { router.push(role === 'admin' ? '/console/overview' : '/console/account') }
}

function handlePrimaryAction() {
  switch (mode.value) {
    case 'password': handlePasswordLogin(); break
    case 'email': handleEmailLogin(); break
    case 'register': handleRegister(); break
    case 'reset': handleResetPassword(); break
    case 'authorize': handleAuthorize('approve'); break
    case 'restricted': mode.value = 'password'; break
  }
}

function handleSecondaryAction() {
  switch (mode.value) {
    case 'authorize': handleAuthorize('deny'); break
    case 'register': mode.value = 'password'; break
    case 'reset': mode.value = 'password'; break
    default:
      if (showResetTab.value) { mode.value = 'reset' }
      else { MessagePlugin.warning('邮箱服务未配置，请联系管理员重置密码') }
      break
  }
}
</script>

<template>
  <div :class="isAuthorizeOnly ? 'auth-centered' : oauthCtx ? 'auth-grid' : 'auth-centered'">
    <section class="panel-card auth-card relative overflow-hidden">
      <div class="page-header">
        <div>
          <p v-if="!isAuthorizeOnly" class="eyebrow">身份入口</p>
          <h1 class="page-title">{{ titleMap[mode] }}</h1>
          <p class="page-copy">{{ descriptionMap[mode] }}</p>
        </div>
        <div v-if="!isAuthorizeOnly" class="mode-switch">
          <button :class="['mode-pill', mode === 'password' && 'is-active']" @click="mode = 'password'">密码登录</button>
          <button v-if="showEmailTab" :class="['mode-pill', mode === 'email' && 'is-active']" @click="mode = 'email'">验证码登录</button>
          <button v-if="showRegisterTab" :class="['mode-pill', mode === 'register' && 'is-active']" @click="mode = 'register'">注册</button>
          <button v-if="showResetTab" :class="['mode-pill', mode === 'reset' && 'is-active']" @click="mode = 'reset'">找回密码</button>
          <button v-if="showAuthorizeTab" :class="['mode-pill', mode === 'authorize' && 'is-active']" @click="mode = 'authorize'">授权确认</button>
        </div>
      </div>

      <div class="section-divider mt-6 pt-6">
        <!-- Password -->
        <div v-if="mode === 'password'" class="space-y-5">
          <t-form :data="credentialsForm" label-align="top" class="space-y-4">
            <t-form-item label="用户名 / 邮箱">
              <t-input v-model="credentialsForm.account" size="large" placeholder="输入用户名或邮箱" @keyup.enter="handlePasswordLogin" />
            </t-form-item>
            <t-form-item label="密码">
              <t-input v-model="credentialsForm.password" type="password" size="large" placeholder="输入密码" @keyup.enter="handlePasswordLogin" />
            </t-form-item>
          </t-form>

          <!-- Third-party login icons -->
          <div v-if="enabledProviders.length > 0" class="space-y-3">
            <div class="flex items-center gap-2">
              <span class="h-px flex-1 bg-[var(--border-primary)]"></span>
              <span class="text-xs text-[var(--text-muted)]">第三方登录</span>
              <span class="h-px flex-1 bg-[var(--border-primary)]"></span>
            </div>
            <div class="flex flex-wrap justify-center gap-4">
              <button
                v-for="provider in enabledProviders"
                :key="provider.name"
                class="social-icon-btn"
                :title="providerLabel(provider.name)"
                @click="handleSocialLogin(provider.name)"
              >
                <span class="social-icon-svg" v-html="providerSvg(provider.name)"></span>
                <span class="social-icon-label">{{ providerLabel(provider.name) }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Email -->
        <div v-else-if="mode === 'email'" class="space-y-5">
          <t-form :data="emailForm" label-align="top" class="space-y-4">
            <t-form-item label="邮箱地址">
              <t-input v-model="emailForm.email" size="large" placeholder="输入接收验证码的邮箱" />
            </t-form-item>
            <t-form-item label="邮箱验证码">
              <div class="flex flex-col gap-3 sm:flex-row">
                <t-input v-model="emailForm.code" size="large" placeholder="输入 6 位验证码" @keyup.enter="handleEmailLogin" />
                <t-button variant="outline" :loading="sendingCode" class="!h-11 !px-5" @click="handleSendCode('login')">发送验证码</t-button>
              </div>
            </t-form-item>
          </t-form>
        </div>

        <!-- Register -->
        <div v-else-if="mode === 'register'" class="space-y-5">
          <div class="rounded-2xl border border-[rgba(0,82,255,0.12)] bg-[var(--accent-soft)] p-4">
            <div class="flex flex-wrap items-center gap-2">
              <StatusTag tone="info" label="OAuth 注册" />
              <StatusTag v-if="oauthCtx" tone="success" label="上下文已校验" />
            </div>
            <p class="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              当前由 <span class="font-semibold text-[var(--text-primary)]">{{ oauthCtx?.clientName || '未知应用' }}</span> 发起授权注册。
            </p>
          </div>
          <t-form :data="registerForm" label-align="top" class="space-y-4">
            <t-form-item v-if="requireEmailVerification" label="邮箱地址"><t-input v-model="registerForm.email" size="large" /></t-form-item>
            <t-form-item v-if="requireEmailVerification" label="邮箱验证码">
              <div class="flex flex-col gap-3 sm:flex-row">
                <t-input v-model="registerForm.code" size="large" />
                <t-button variant="outline" :loading="sendingCode" class="!h-11 !px-5" @click="handleSendCode('register')">发送验证码</t-button>
              </div>
            </t-form-item>
            <t-form-item label="用户名"><t-input v-model="registerForm.username" size="large" /></t-form-item>
            <div class="grid gap-4 md:grid-cols-2">
              <t-form-item label="设置密码"><t-input v-model="registerForm.password" type="password" size="large" /></t-form-item>
              <t-form-item label="确认密码"><t-input v-model="registerForm.confirmPassword" type="password" size="large" /></t-form-item>
            </div>
          </t-form>
        </div>

        <!-- Reset -->
        <div v-else-if="mode === 'reset'" class="space-y-5">
          <t-form :data="resetForm" label-align="top" class="space-y-4">
            <t-form-item label="邮箱地址"><t-input v-model="resetForm.email" size="large" /></t-form-item>
            <t-form-item label="验证码">
              <div class="flex flex-col gap-3 sm:flex-row">
                <t-input v-model="resetForm.code" size="large" />
                <t-button variant="outline" :loading="sendingCode" class="!h-11 !px-5" @click="handleSendCode('reset-password')">发送验证码</t-button>
              </div>
            </t-form-item>
            <t-form-item label="新密码"><t-input v-model="resetForm.password" type="password" size="large" /></t-form-item>
          </t-form>
        </div>

        <!-- Authorize -->
        <div v-else-if="mode === 'authorize' && oauthCtx" class="space-y-5">
          <div class="panel-muted p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="eyebrow">待授权应用</p>
                <h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">{{ oauthCtx.clientName }}</h2>
              </div>
              <StatusTag tone="info" :label="oauthCtx.clientId" />
            </div>
            <p class="mt-4 text-sm leading-7 text-[var(--text-secondary)]">{{ oauthCtx.description }}</p>
          </div>
          <div class="space-y-3">
            <div class="flex flex-wrap gap-2">
              <span v-for="scope in oauthCtx.requestedScopes" :key="scope" class="token-chip font-mono">{{ scope }}</span>
            </div>
            <div class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-muted)] p-4">
              <p class="eyebrow">回调地址</p>
              <p class="mt-3 break-all font-mono text-sm text-[var(--text-secondary)]">{{ oauthCtx.redirectUri }}</p>
            </div>
          </div>
        </div>

        <!-- Restricted -->
        <div v-else class="space-y-5">
          <div class="rounded-2xl border border-[rgba(220,38,38,0.15)] bg-[rgba(239,68,68,0.08)] p-5">
            <div class="flex items-center gap-3">
              <div class="grid h-12 w-12 place-items-center rounded-2xl bg-[rgba(239,68,68,0.12)] text-[var(--danger)]">
                <t-icon name="error-circle-filled" size="22px" />
              </div>
              <div>
                <h2 class="text-lg font-semibold text-[var(--text-primary)]">应用校验失败</h2>
                <p class="mt-1 text-sm text-[var(--text-muted)]">回调地址、Client ID 或注册策略不满足当前访问条件。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="action-row mt-6">
        <t-button theme="primary" size="large" :loading="submitting" class="!px-6" @click="handlePrimaryAction">
          {{ primaryActionLabel }}
        </t-button>
        <t-button variant="outline" size="large" class="!px-6" @click="handleSecondaryAction">
          {{ mode === 'authorize' ? '拒绝' : mode === 'register' ? '切换到登录' : mode === 'reset' ? '返回登录' : '忘记密码' }}
        </t-button>
      </div>
    </section>

    <aside v-if="oauthCtx && !isAuthorizeOnly" class="space-y-6">
      <section class="panel-contrast auth-card" style="animation-delay: 0.3s;">
        <p class="eyebrow !text-slate-400">应用上下文</p>
        <h2 class="mt-3 text-3xl font-display text-white">来自 {{ oauthCtx.clientName }}</h2>
        <p class="mt-4 text-sm leading-7 text-slate-300">认证中心会根据 client_id 和 redirect_uri 决定登录与注册流程。</p>
        <div class="stack-list mt-6">
          <div class="panel-muted stack-item !bg-white/6 !border-white/10">
            <div>
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">Client ID</p>
              <p class="mt-2 font-mono text-sm text-slate-100">{{ oauthCtx.clientId }}</p>
            </div>
            <StatusTag tone="info" label="OAuth 2.0" />
          </div>
          <div class="panel-muted stack-item !bg-white/6 !border-white/10">
            <div>
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">注册策略</p>
              <p class="mt-2 text-sm text-slate-100">{{ oauthCtx.allowRegistration ? '允许注册' : '仅登录' }}</p>
            </div>
            <StatusTag :tone="oauthCtx.allowRegistration ? 'success' : 'neutral'" :label="oauthCtx.allowRegistration ? 'allowRegistration' : 'loginOnly'" />
          </div>
        </div>
      </section>
    </aside>

    <t-dialog
      v-model:visible="socialQrVisible"
      :header="`${providerLabel(socialQrProvider)} 扫码登录`"
      width="430px"
      :footer="false"
      @close="resetSocialQr"
    >
      <div class="space-y-4 pt-2 text-center">
        <div class="relative mx-auto grid min-h-[250px] w-[250px] place-items-center rounded-3xl border border-[var(--border-primary)] bg-white p-3">
          <img v-if="socialQrDisplayUrl" :src="socialQrDisplayUrl" alt="第三方授权二维码" class="h-[230px] w-[230px] rounded-2xl object-contain" @error="handleSocialQrImageError" />
          <div v-else class="grid h-[230px] w-[230px] place-items-center rounded-2xl bg-slate-50 text-sm text-slate-500">二维码生成中...</div>
          <div
            v-if="socialQrStatus === 'success' || socialQrStatus === 'failed' || socialQrStatus === 'expired'"
            class="absolute inset-3 grid place-items-center rounded-2xl bg-white/92 backdrop-blur-sm"
          >
            <div class="space-y-2">
              <div
                :class="[
                  'mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl font-bold text-white',
                  socialQrStatus === 'success' ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'
                ]"
              >
                {{ socialQrStatus === 'success' ? '✓' : '!' }}
              </div>
              <p class="text-sm font-semibold text-slate-900">
                {{ socialQrStatus === 'success' ? '授权成功' : socialQrStatus === 'expired' ? '二维码过期' : '授权失败' }}
              </p>
            </div>
          </div>
        </div>
        <p class="text-sm font-semibold text-[var(--text-primary)]">{{ socialQrMessage }}</p>
        <p v-if="socialQrStatus === 'pending'" class="text-xs text-[var(--text-muted)]">请扫码并在手机完成授权，本页面会自动监听结果。</p>
        <div v-if="socialQrStatus === 'failed' || socialQrStatus === 'expired'" class="action-row justify-center">
          <t-button variant="outline" @click="socialQrVisible = false; resetSocialQr()">关闭</t-button>
          <t-button theme="primary" @click="handleSocialLogin(socialQrProvider)">重新生成</t-button>
        </div>
      </div>
    </t-dialog>
  </div>
</template>

<style scoped>
.auth-centered {
  max-width: 520px;
  margin: 0 auto;
}

.social-icon-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: 14px;
  border: 1px solid var(--border-primary);
  background: var(--surface-muted);
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 64px;
}
.social-icon-btn:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: translateY(-2px);
}
.social-icon-svg {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
}
.social-icon-svg :deep(svg) {
  width: 100%;
  height: 100%;
}
.social-icon-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-align: center;
}
</style>
