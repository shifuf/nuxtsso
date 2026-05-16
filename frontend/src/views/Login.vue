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
  password: '欢迎回来', email: '邮箱验证码登录', register: '从接入应用注册',
  reset: '找回密码', authorize: '授权确认', restricted: '访问受限',
}

const descriptionMap: Record<AuthMode, string> = {
  password: '请登录您的账户以继续',
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
  else { router.push(role === 'admin' ? '/user/overview' : '/user/account') }
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
  <div :class="['lumina-login', isAuthorizeOnly && 'lumina-login--authorize']">
    <div class="login-split-card">
      <aside class="login-visual" aria-hidden="true">
        <span class="login-shape login-shape--one"></span>
        <span class="login-shape login-shape--two"></span>
        <span class="login-shape login-shape--three"></span>
        <div class="login-visual__center">
          <div class="login-visual__icon"><t-icon name="secured" size="42px" /></div>
          <h2>一证通行</h2>
          <p>安全、便捷的统一身份认证平台</p>
          <div class="login-dots"><span></span><span></span><span></span></div>
        </div>
      </aside>

    <section class="lumina-card" aria-label="一证通行登录面板">
      <div class="lumina-brand">
        <div class="lumina-brand__mark">证</div>
        <span class="lumina-brand__text">一证通行</span>
      </div>

      <header class="lumina-heading">
        <h1>{{ titleMap[mode] }}</h1>
        <p>{{ descriptionMap[mode] }}</p>
      </header>

      <div v-if="showAuthorizeTab && mode !== 'authorize'" class="lumina-context">
        <span>授权上下文</span>
        <button type="button" @click="mode = 'authorize'">授权确认</button>
      </div>

      <form class="lumina-form" @submit.prevent="handlePrimaryAction">
        <template v-if="mode === 'password'">
          <div class="lumina-field">
            <label>邮箱地址</label>
            <div class="lumina-input">
              <span>@</span>
              <input
                v-model="credentialsForm.account"
                autocomplete="username"
                placeholder="请输入邮箱地址"
                type="text"
              />
            </div>
          </div>

          <div class="lumina-field">
            <div class="lumina-label-row">
              <label>登录密码</label>
              <button v-if="showResetTab" type="button" @click="mode = 'reset'">忘记密码？</button>
            </div>
            <div class="lumina-input">
              <span>*</span>
              <input
                v-model="credentialsForm.password"
                autocomplete="current-password"
                placeholder="••••••••"
                type="password"
              />
            </div>
          </div>
        </template>

        <template v-else-if="mode === 'email'">
          <div class="lumina-field">
            <label>邮箱地址</label>
            <div class="lumina-input">
              <span>@</span>
              <input v-model="emailForm.email" autocomplete="email" placeholder="请输入邮箱地址" type="email" />
            </div>
          </div>

          <div class="lumina-field">
            <div class="lumina-label-row">
              <label>邮箱验证码</label>
              <button type="button" :disabled="sendingCode" @click="handleSendCode('login')">
                {{ sendingCode ? '发送中...' : '发送验证码' }}
              </button>
            </div>
            <div class="lumina-input">
              <span>#</span>
              <input v-model="emailForm.code" class="is-code" inputmode="numeric" placeholder="请输入 6 位验证码" type="text" />
            </div>
          </div>
        </template>

        <template v-else-if="mode === 'register'">
          <div v-if="oauthCtx" class="lumina-oauth-note">
            <div>
              <StatusTag tone="info" label="授权注册" />
              <StatusTag tone="success" label="已校验" />
            </div>
            <p>当前由 {{ oauthCtx.clientName || '未识别应用' }} 发起授权注册。</p>
          </div>

          <div v-if="requireEmailVerification" class="lumina-field">
            <label>邮箱地址</label>
            <div class="lumina-input">
              <span>@</span>
              <input v-model="registerForm.email" autocomplete="email" placeholder="请输入邮箱地址" type="email" />
            </div>
          </div>

          <div v-if="requireEmailVerification" class="lumina-field">
            <div class="lumina-label-row">
              <label>邮箱验证码</label>
              <button type="button" :disabled="sendingCode" @click="handleSendCode('register')">
                {{ sendingCode ? '发送中...' : '发送验证码' }}
              </button>
            </div>
            <div class="lumina-input">
              <span>#</span>
              <input v-model="registerForm.code" class="is-code" inputmode="numeric" placeholder="请输入 6 位验证码" type="text" />
            </div>
          </div>

          <div class="lumina-field">
            <label>用户名</label>
            <div class="lumina-input">
              <span>ID</span>
              <input v-model="registerForm.username" autocomplete="username" placeholder="请输入用户名" type="text" />
            </div>
          </div>

          <div class="lumina-field">
            <label>登录密码</label>
            <div class="lumina-input">
              <span>*</span>
              <input v-model="registerForm.password" autocomplete="new-password" placeholder="••••••••" type="password" />
            </div>
          </div>

          <div class="lumina-field">
            <label>确认密码</label>
            <div class="lumina-input">
              <span>*</span>
              <input v-model="registerForm.confirmPassword" autocomplete="new-password" placeholder="••••••••" type="password" />
            </div>
          </div>
        </template>

        <template v-else-if="mode === 'reset'">
          <div class="lumina-field">
            <label>邮箱地址</label>
            <div class="lumina-input">
              <span>@</span>
              <input v-model="resetForm.email" autocomplete="email" placeholder="请输入邮箱地址" type="email" />
            </div>
          </div>

          <div class="lumina-field">
            <div class="lumina-label-row">
              <label>邮箱验证码</label>
              <button type="button" :disabled="sendingCode" @click="handleSendCode('reset-password')">
                {{ sendingCode ? '发送中...' : '发送验证码' }}
              </button>
            </div>
            <div class="lumina-input">
              <span>#</span>
              <input v-model="resetForm.code" class="is-code" inputmode="numeric" placeholder="请输入 6 位验证码" type="text" />
            </div>
          </div>

          <div class="lumina-field">
            <label>新登录密码</label>
            <div class="lumina-input">
              <span>*</span>
              <input v-model="resetForm.password" autocomplete="new-password" placeholder="••••••••" type="password" />
            </div>
          </div>
        </template>

        <template v-else-if="mode === 'authorize' && oauthCtx">
          <div class="lumina-authorize">
            <div class="lumina-authorize__head">
              <div>
                <span>接入应用</span>
                <h2>{{ oauthCtx.clientName }}</h2>
              </div>
              <StatusTag tone="info" :label="oauthCtx.clientId" />
            </div>
            <p>{{ oauthCtx.description }}</p>
            <div class="lumina-scope-list">
              <span v-for="scope in oauthCtx.requestedScopes" :key="scope">{{ scope }}</span>
            </div>
            <code>{{ oauthCtx.redirectUri }}</code>
          </div>
        </template>

        <template v-else>
          <div class="lumina-restricted">
            <strong>应用校验失败</strong>
            <p>回调地址、Client ID 或注册策略不满足当前访问条件。</p>
          </div>
        </template>

        <button class="lumina-submit" type="submit" :disabled="submitting">
          <span v-if="submitting" class="lumina-spinner" aria-hidden="true"></span>
          {{ primaryActionLabel }}
          <span aria-hidden="true">-&gt;</span>
        </button>

        <button
          v-if="mode === 'authorize'"
          class="lumina-secondary"
          type="button"
          @click="handleSecondaryAction"
        >
          拒绝授权
        </button>

        <div v-if="mode !== 'authorize' && mode !== 'restricted'" class="lumina-mode-grid">
          <button
            v-if="showEmailTab"
            type="button"
            @click="mode = mode === 'email' ? 'password' : 'email'"
          >
            {{ mode === 'email' ? '密码登录' : '邮箱验证码登录' }}
          </button>
          <button
            v-if="showRegisterTab"
            type="button"
            @click="mode = mode === 'register' ? 'password' : 'register'"
          >
            {{ mode === 'register' ? '已有账号登录' : '注册新账号' }}
          </button>
        </div>

        <template v-if="enabledProviders.length > 0 && mode !== 'authorize' && mode !== 'restricted'">
          <div class="lumina-divider">
            <span></span>
            <p>或使用第三方登录</p>
            <span></span>
          </div>

          <div class="social-grid">
            <button
              v-for="provider in enabledProviders"
              :key="provider.name"
              class="social-icon-btn"
              type="button"
              :title="providerLabel(provider.name)"
              @click="handleSocialLogin(provider.name)"
            >
              <span class="social-icon-svg" v-html="providerSvg(provider.name)"></span>
              <span class="social-icon-label">{{ providerLabel(provider.name) }}</span>
            </button>
          </div>
        </template>

        <p v-if="showRegisterTab && mode !== 'authorize' && mode !== 'restricted'" class="lumina-foot-action">
          {{ mode === 'register' ? '已有账号？' : '还没有账号？' }}
          <button type="button" @click="mode = mode === 'register' ? 'password' : 'register'">
            {{ mode === 'register' ? '去登录' : '立即注册' }}
          </button>
        </p>
      </form>
    </section>
    </div>

    <div class="lumina-copyright">© 2026 一证通行</div>

    <t-dialog
      v-model:visible="socialQrVisible"
      :header="`${providerLabel(socialQrProvider)} 扫码登录`"
      width="430px"
      :footer="false"
      @close="resetSocialQr"
    >
      <div class="space-y-4 pt-2 text-center">
        <div class="relative mx-auto grid min-h-[260px] w-[260px] place-items-center rounded-3xl border border-[var(--border-primary)] bg-white p-3">
          <img v-if="socialQrDisplayUrl" :src="socialQrDisplayUrl" alt="第三方授权二维码" class="h-[230px] w-[230px] rounded-2xl object-contain" @error="handleSocialQrImageError" />
          <div v-else class="grid h-[230px] w-[230px] place-items-center rounded-2xl bg-slate-50 text-sm text-slate-500">
            <div class="space-y-2">
              <div class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"></div>
              <p>二维码生成中...</p>
            </div>
          </div>
          <div
            v-if="socialQrStatus === 'success' || socialQrStatus === 'failed' || socialQrStatus === 'expired'"
            class="absolute inset-3 grid place-items-center rounded-2xl bg-white/92 backdrop-blur-sm"
          >
            <div class="space-y-3">
              <div
                :class="[
                  'mx-auto grid h-16 w-16 place-items-center rounded-2xl text-2xl font-bold text-white',
                  socialQrStatus === 'success' ? 'bg-[var(--success)] shadow-xl shadow-emerald-500/20' : 'bg-[var(--danger)] shadow-xl shadow-rose-500/20'
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
          <t-button variant="outline" class="lumina-outline-btn" @click="socialQrVisible = false; resetSocialQr()">关闭</t-button>
          <t-button theme="primary" class="lumina-primary-btn" @click="handleSocialLogin(socialQrProvider)">重新生成</t-button>
        </div>
      </div>
    </t-dialog>
  </div>
</template>

<style scoped>
.lumina-login {
  position: relative;
  z-index: 1;
  width: min(100%, 480px);
  padding: 8px;
  animation: lumina-scale-in 0.5s var(--ease-lumina) both;
}

.lumina-login--authorize {
  width: min(100%, 560px);
}

.lumina-card {
  width: 100%;
  padding: 32px;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-2xl);
  background: var(--surface-secondary);
  box-shadow: var(--shadow-card-hover);
}

:global(:root[data-app-theme='dark']) .lumina-card {
  background: #0f172a;
  border-color: rgba(148, 163, 184, 0.12);
  box-shadow: 0 28px 80px -32px rgba(0, 0, 0, 0.75);
}

.lumina-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 40px;
}

.lumina-brand__mark {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 18px;
  background: var(--accent);
  color: #fff;
  font-size: 20px;
  font-weight: 900;
  box-shadow: var(--shadow-accent);
}

.lumina-brand__text {
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.08em;
}

.lumina-heading {
  margin-bottom: 40px;
  text-align: center;
}

.lumina-heading h1 {
  margin: 0;
  color: var(--text-primary);
  font-size: 30px;
  font-weight: 900;
  letter-spacing: -0.06em;
}

.lumina-heading p {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
}

.lumina-context,
.lumina-oauth-note,
.lumina-authorize,
.lumina-restricted {
  margin-bottom: 20px;
  padding: 16px;
  border: 1px solid rgba(50, 88, 255, 0.14);
  border-radius: 1.25rem;
  background: var(--accent-soft);
}

.lumina-context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.lumina-context span,
.lumina-authorize__head span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.20em;
  text-transform: uppercase;
}

.lumina-context button,
.lumina-label-row button,
.lumina-foot-action button {
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.lumina-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.lumina-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lumina-field label,
.lumina-label-row label {
  margin-left: 4px;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.lumina-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.lumina-label-row button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.lumina-input {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 0 18px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-muted);
  transition:
    border-color var(--duration-base) var(--ease-lumina),
    box-shadow var(--duration-base) var(--ease-lumina),
    background-color var(--duration-base) var(--ease-lumina);
}

.lumina-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px rgba(50, 88, 255, 0.10);
}

.lumina-input span {
  width: 22px;
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 900;
  text-align: center;
  transition: color 180ms ease;
}

.lumina-input:focus-within span {
  color: var(--accent);
}

.lumina-input input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
}

.lumina-input input::placeholder {
  color: var(--text-faint);
}

.lumina-input input.is-code {
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.20em;
}

.lumina-submit,
.lumina-secondary,
.lumina-mode-grid button {
  min-height: 48px;
  border: 0;
  border-radius: 1rem;
  cursor: pointer;
  font-weight: 900;
  transition:
    transform var(--duration-fast) var(--ease-lumina),
    background-color var(--duration-fast) var(--ease-lumina),
    color var(--duration-fast) var(--ease-lumina),
    opacity var(--duration-fast) var(--ease-lumina),
    box-shadow var(--duration-fast) var(--ease-lumina);
}

.lumina-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 4px;
  background: var(--accent);
  color: #fff;
  box-shadow: 0 20px 42px -22px rgba(50, 88, 255, 0.65);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.lumina-submit:hover {
  background: var(--accent-hover);
  box-shadow: 0 24px 48px -22px rgba(50, 88, 255, 0.75);
}

.lumina-submit:active,
.lumina-secondary:active,
.lumina-mode-grid button:active,
.social-icon-btn:active {
  transform: scale(0.95);
}

.lumina-submit:disabled {
  cursor: not-allowed;
  opacity: 0.78;
}

.lumina-secondary {
  border: 1px solid var(--border-primary);
  background: var(--surface-muted);
  color: var(--text-muted);
}

.lumina-mode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
  margin-top: 4px;
}

.lumina-mode-grid button {
  background: var(--surface-muted);
  color: var(--text-faint);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.lumina-mode-grid button:hover,
.lumina-foot-action button:hover {
  color: var(--accent);
}

.lumina-divider {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 0;
}

.lumina-divider span {
  height: 1px;
  flex: 1;
  background: var(--border-primary);
}

.lumina-divider p {
  margin: 0;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.lumina-foot-action {
  margin: 0;
  padding-top: 4px;
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.10em;
  text-align: center;
  text-transform: uppercase;
}

.lumina-foot-action button {
  margin-left: 8px;
  font-size: 12px;
  letter-spacing: 0;
  text-transform: none;
}

.lumina-oauth-note div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.lumina-oauth-note p,
.lumina-restricted p {
  margin: 10px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
}

.lumina-authorize {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lumina-authorize__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.lumina-authorize h2 {
  margin: 6px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.05em;
}

.lumina-authorize p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.7;
}

.lumina-authorize code {
  display: block;
  overflow-wrap: anywhere;
  padding: 12px;
  border: 1px solid var(--border-primary);
  border-radius: 0.9rem;
  background: var(--surface-primary);
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 1.6;
}

.lumina-scope-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.lumina-scope-list span {
  padding: 6px 10px;
  border: 1px solid rgba(50, 88, 255, 0.18);
  border-radius: 10px;
  background: rgba(50, 88, 255, 0.08);
  color: var(--accent);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 700;
}

.lumina-restricted {
  border-color: rgba(244, 63, 94, 0.20);
  background: rgba(244, 63, 94, 0.10);
}

.lumina-restricted strong {
  color: var(--danger);
  font-size: 16px;
}

.lumina-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.42);
  border-top-color: #fff;
  border-radius: 50%;
  animation: lumina-spin 0.8s linear infinite;
}

.lumina-copyright {
  margin-top: 32px;
  color: #cbd5e1;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.20em;
  text-align: center;
  text-transform: uppercase;
}

.lumina-login {
  width: min(100%, 1024px);
}

.lumina-login--authorize {
  width: min(100%, 1024px);
}

.login-split-card {
  display: grid;
  grid-template-columns: minmax(360px, 1.05fr) minmax(360px, 0.95fr);
  overflow: hidden;
  border-radius: 18px;
  background: var(--surface-secondary);
  box-shadow: 0 28px 76px -42px rgba(15, 23, 42, 0.48);
}

.login-visual {
  position: relative;
  display: grid;
  min-height: 612px;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(circle at 16% 12%, rgba(148, 163, 184, 0.14), transparent 9%),
    linear-gradient(145deg, #111827 0%, #26364a 100%);
  color: #fff;
}

.login-visual__center {
  position: relative;
  z-index: 1;
  text-align: center;
}

.login-visual__icon {
  display: grid;
  width: 80px;
  height: 80px;
  margin: 0 auto 24px;
  place-items: center;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.14);
}

.login-visual h2 {
  margin: 0;
  font-size: 30px;
  font-weight: 950;
  letter-spacing: -0.05em;
}

.login-visual p {
  margin: 16px 0 0;
  color: rgba(226, 232, 240, 0.86);
  font-size: 16px;
  font-weight: 700;
}

.login-dots {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 42px;
}

.login-dots span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.48);
}

.login-shape {
  position: absolute;
  display: block;
  background: rgba(255, 255, 255, 0.10);
}

.login-shape--one {
  top: 34px;
  left: 42px;
  width: 80px;
  height: 80px;
  border-radius: 999px;
}

.login-shape--two {
  right: 32px;
  bottom: 72px;
  width: 56px;
  height: 56px;
  border-radius: 999px;
}

.login-shape--three {
  left: 64px;
  bottom: 202px;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  transform: rotate(45deg);
}

.login-split-card .lumina-card {
  border: 0;
  border-radius: 0;
  padding: 42px 40px;
  box-shadow: none;
}

.login-split-card .lumina-brand {
  display: none;
}

.login-split-card .lumina-heading {
  margin-bottom: 32px;
  text-align: left;
}

.login-split-card .lumina-heading h1 {
  font-size: 28px;
  letter-spacing: -0.04em;
}

.login-split-card .lumina-field label,
.login-split-card .lumina-label-row label {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: none;
}

.login-split-card .lumina-input {
  min-height: 46px;
  border-radius: 12px;
  background: var(--surface-secondary);
}

.login-split-card .lumina-submit {
  min-height: 44px;
  border-radius: 11px;
  background: #17233c;
  box-shadow: none;
  font-size: 14px;
  letter-spacing: 0;
  text-transform: none;
}

.login-split-card .lumina-submit:hover {
  background: #26364a;
  box-shadow: none;
}

.social-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 12px;
}

.social-icon-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 8px;
  border-radius: 1rem;
  border: 1px solid var(--border-primary);
  background: transparent;
  cursor: pointer;
  transition: all 200ms ease;
  min-width: 0;
}

.social-icon-btn:hover {
  border-color: rgba(50, 88, 255, 0.22);
  background: var(--surface-muted);
  transform: scale(1.05);
}

.social-icon-svg {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--text-muted);
}

.social-icon-svg :deep(svg) {
  width: 100%;
  height: 100%;
}

.social-icon-label {
  font-size: 9px;
  font-weight: 900;
  color: var(--text-faint);
  text-align: center;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

:deep(.lumina-outline-btn) {
  border-radius: 1rem !important;
  font-weight: 700 !important;
  transition: all 150ms ease !important;
}
:deep(.lumina-outline-btn:hover) {
  transform: translateY(-1px) !important;
}
:deep(.lumina-outline-btn:active) {
  transform: scale(0.95) !important;
}

@keyframes lumina-spin {
  to { transform: rotate(360deg); }
}

@keyframes lumina-scale-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 520px) {
  .lumina-login {
    padding: 0;
  }

  .lumina-card {
    padding: 24px;
    border-radius: 2rem;
  }

  .lumina-brand {
    margin-bottom: 30px;
  }

  .lumina-heading {
    margin-bottom: 30px;
  }

  .lumina-heading h1 {
    font-size: 26px;
  }
}
</style>
