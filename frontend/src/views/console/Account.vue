<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NInput, NModal, NSelect, NSwitch, NDropdown, NUpload, type UploadCustomRequestOptions, type UploadFileInfo } from 'naive-ui'
import { MessagePlugin, DialogPlugin } from '../../utils/ui'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'
import type { AccountSession, SocialAccountBinding, ApplicationItem, ApplicationCreateResponse } from '../../types/api'
import { formatDateTime, parseBrowser } from '../../utils/console'
import { createAuthorizeQrDataUrl, createQrDisplayUrl } from '../../utils/qrcode'
import { foldWechatProviders, isProviderBound, resolveRuntimeProviderName } from '../../utils/socialProviders'
import { APPLICATION_SCOPE_OPTIONS, defaultApplicationScopes, normalizeApplicationScopes, scopeLabel } from '../../utils/oauthScopes'
import MetricCard from '../../components/MetricCard.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'

const authStore = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const sessions = ref<AccountSession[]>([])
const bindings = ref<SocialAccountBinding[]>([])
const socialProviders = ref<Array<{ name: string; type?: string; enabled: boolean }>>([])
const applications = ref<ApplicationItem[]>([])
const createdApplication = ref<ApplicationCreateResponse | null>(null)

const profileForm = ref({ username: '' })
const avatarPreview = ref('')
const avatarUploadFiles = ref<UploadFileInfo[]>([])
const passwordForm = ref({ password: '', confirmPassword: '' })
const showPasswordSection = ref(false)
const showApplicationForm = ref(false)
interface ApplicationFormData {
  name: string
  description: string
  redirectUris: string
  scopes: string[]
  allowRegistration: boolean
}

const applicationForm = ref<ApplicationFormData>({
  name: '',
  description: '',
  redirectUris: '',
  scopes: defaultApplicationScopes(),
  allowRegistration: true,
})

const bindAccountForm = ref({ username: '', password: '' })
const showBindAccount = ref(false)
const showSocialBindDialog = ref(false)
const selectedBindProvider = ref('')
const socialBindUrl = ref('')
const socialBindDisplayUrl = ref('')
const socialBindState = ref('')
const socialBindStatus = ref<'idle' | 'pending' | 'scanned' | 'success' | 'failed' | 'expired'>('idle')
const socialBindMessage = ref('')
let socialBindTimer: ReturnType<typeof setInterval> | null = null
const socialBindQrOptions = {
  width: 230,
  margin: 2,
  dark: '#111827',
  light: '#ffffff',
}

// ── Helpers ──
const user = () => authStore.user
const isSocial = () => {
  const u = user()
  if (!u) return false
  const source = u.registrationSource?.toLowerCase() || ''
  const socialSources = ['wechat', 'qq', 'github', 'google', 'alipay', 'weibo', 'baidu', 'huawei', 'xiaomi', 'douyin', 'bilibili', 'dingtalk']
  return Boolean(
    (u.email?.endsWith('@social.local') && (source.includes('social') || socialSources.includes(source))) ||
    (socialSources.includes(source) && !u.hasPassword)
  )
}
const isBoundToUser = () => Boolean(user()?.boundToUser)
const availableBindProviders = computed(() => {
  const bound = new Set(bindings.value.map(item => item.provider))
  return socialProviders.value.filter(item => item.enabled && !isProviderBound(item, bound))
})

const availableBindDropdownOptions = computed(() =>
  availableBindProviders.value.map(item => ({
    label: providerLabel(item.name),
    key: item.name,
  }))
)

const socialProviderCount = ref(0)
const sessionCount = ref(0)

onMounted(async () => {
  await loadData()
})

onUnmounted(() => {
  stopSocialBindPolling()
})

async function loadData() {
  loading.value = true
  try {
    const [sessionsRes, bindingsRes, providersRes] = await Promise.all([
      authApi.listSessions(),
      authApi.listSocialBindings(),
      authApi.getSocialProviders(),
    ])
    sessions.value = sessionsRes
    bindingsRes && (bindings.value = bindingsRes)
    socialProviders.value = foldWechatProviders(providersRes)
    applications.value = await authApi.listAccountApplications()

    const u = user()
    if (u) {
      profileForm.value.username = u.username || ''
      avatarPreview.value = u.avatar || ''
      avatarUploadFiles.value = u.avatar
        ? [{ id: 'avatar', name: 'avatar', url: u.avatar, status: 'finished' } as UploadFileInfo]
        : []
    }

    socialProviderCount.value = bindings.value.length
    sessionCount.value = sessions.value.length
  } catch { /* silent */ }
  finally { loading.value = false }
}

async function saveProfile() {
  if (!profileForm.value.username) return MessagePlugin.warning('请输入用户名')
  saving.value = true
  try {
    await authApi.updateProfile({
      username: profileForm.value.username,
    })
    await authStore.refreshSession()
    MessagePlugin.success('资料已更新')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '更新失败') }
  finally { saving.value = false }
}

function beforeAvatarUpload(options: { file: UploadFileInfo }) {
  const target = options.file.file
  if (!target) return false
  if (!target.type.startsWith('image/')) {
    MessagePlugin.warning('请选择图片文件')
    return false
  }
  if (target.size > 2 * 1024 * 1024) {
    MessagePlugin.warning('头像文件不能超过 2MB')
    return false
  }
  avatarPreview.value = URL.createObjectURL(target)
  return true
}

async function requestAvatarUpload({ file, onFinish, onError }: UploadCustomRequestOptions) {
  const raw = file.file
  if (!raw) {
    onError()
    return
  }
  if (!raw.type.startsWith('image/')) {
    MessagePlugin.warning('请选择图片文件')
    onError()
    return
  }
  saving.value = true
  try {
    await authApi.uploadAvatar(raw)
    await authStore.refreshSession()
    avatarPreview.value = user()?.avatar || ''
    MessagePlugin.success('头像已更新')
    onFinish()
  } catch (e: unknown) {
    const message = (e as { message?: string })?.message || '上传失败'
    MessagePlugin.error(message)
    onError()
  }
  finally { saving.value = false }
}

async function createApplication() {
  if (!applicationForm.value.name.trim()) return MessagePlugin.warning('请输入应用名称')
  if (!applicationForm.value.redirectUris.trim()) return MessagePlugin.warning('请输入至少一个回调地址')
  saving.value = true
  try {
    const result = await authApi.createAccountApplication({
      name: applicationForm.value.name.trim(),
      description: applicationForm.value.description.trim() || undefined,
      redirectUris: applicationForm.value.redirectUris.split('\n').map(s => s.trim()).filter(Boolean),
      scopes: normalizeApplicationScopes(applicationForm.value.scopes),
      allowRegistration: applicationForm.value.allowRegistration,
    })
    createdApplication.value = result
    applications.value = await authApi.listAccountApplications()
    showApplicationForm.value = false
    applicationForm.value = {
      name: '',
      description: '',
      redirectUris: '',
      scopes: defaultApplicationScopes(),
      allowRegistration: true,
    }
    MessagePlugin.success('应用已创建，等待管理员审核启用')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '创建失败') }
  finally { saving.value = false }
}

function openApplicationDialog() {
  applicationForm.value = {
    name: '',
    description: '',
    redirectUris: '',
    scopes: defaultApplicationScopes(),
    allowRegistration: true,
  }
  showApplicationForm.value = true
}

async function revokeSession(id: string) {
  const dialog = DialogPlugin.confirm({
    header: '注销会话',
    body: '确定要注销该会话吗？对应设备将被强制退出。',
    confirmBtn: '注销',
    cancelBtn: '取消',
    theme: 'warning',
    onConfirm: async () => {
      try {
        const result = await authApi.revokeSession(id)
        if (result.current) {
          authStore.clearSession()
          window.location.href = '/login'
          return
        }
        MessagePlugin.success('会话已注销')
        await loadData()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '操作失败') }
      dialog.hide()
    },
  })
}

async function revokeOtherSessions() {
  const dialog = DialogPlugin.confirm({
    header: '注销其他设备',
    body: '将退出除当前设备之外的所有活跃会话。',
    confirmBtn: '确认注销',
    cancelBtn: '取消',
    theme: 'warning',
    onConfirm: async () => {
      try {
        const result = await authApi.revokeOtherSessions()
        MessagePlugin.success(`已注销 ${result.revokedCount} 个会话`)
        await loadData()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '操作失败') }
      dialog.hide()
    },
  })
}

// ── Social Binding (regular users only) ──
async function unbindSocial(provider: string) {
  const dialog = DialogPlugin.confirm({
    header: '解除绑定',
    body: `确定要解除 ${provider} 的第三方绑定吗？解绑后 ${provider} 将不再登录当前账号，但仍可作为独立第三方账号登录。`,
    confirmBtn: '确认解绑',
    cancelBtn: '取消',
    theme: 'danger',
    onConfirm: async () => {
      try {
        await authApi.unbindSocial(provider)
        MessagePlugin.success(`已解绑 ${provider}`)
        await loadData()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '解绑失败') }
      dialog.hide()
    },
  })
}

function providerLabel(name: string) {
  const labels: Record<string, string> = {
    wechat: '微信',
    'wechat-aggregated': '微信',
    'wechat-mini': '微信',
    qq: 'QQ',
    github: 'GitHub',
    google: 'Google',
    alipay: '支付宝',
    weibo: '微博',
    baidu: '百度',
    huawei: '华为',
    xiaomi: '小米',
    douyin: '抖音',
    bilibili: 'B站',
    dingtalk: '钉钉',
  }
  return labels[name] ?? name
}

function handleSocialProviderDropdownSelect(key: string | number) {
  void openSocialBindQr(String(key))
}

function resetSocialBindQr() {
  stopSocialBindPolling()
  selectedBindProvider.value = ''
  socialBindUrl.value = ''
  socialBindDisplayUrl.value = ''
  socialBindState.value = ''
  socialBindStatus.value = 'idle'
  socialBindMessage.value = ''
}

function stopSocialBindPolling() {
  if (socialBindTimer) {
    clearInterval(socialBindTimer)
    socialBindTimer = null
  }
}

async function openSocialBindQr(provider: string) {
  resetSocialBindQr()
  showSocialBindDialog.value = true
  selectedBindProvider.value = provider
  socialBindStatus.value = 'pending'
  socialBindMessage.value = '正在生成绑定二维码...'

  try {
    const selectedProvider = socialProviders.value.find(item => item.name === provider)
    const runtimeProvider = selectedProvider
      ? resolveRuntimeProviderName(selectedProvider)
      : provider
    const result = await authApi.createSocialBind(runtimeProvider, '/user/account')
    socialBindUrl.value = result.authorizeUrl
    socialBindState.value = result.state
    socialBindMessage.value = provider === 'wechat'
      ? '请使用微信扫码'
      : '等待扫码/授权'
    socialBindDisplayUrl.value = await createQrDisplayUrl(
      socialBindUrl.value,
      result.qrCodeUrl,
      socialBindQrOptions,
    )

    socialBindTimer = setInterval(() => {
      void checkSocialBindStatus()
    }, 1800)
    void checkSocialBindStatus()
  } catch (e: unknown) {
    socialBindStatus.value = 'failed'
    socialBindMessage.value = (e as { message?: string })?.message || '生成绑定二维码失败'
  }
}

async function handleSocialBindQrImageError() {
  if (!socialBindUrl.value || socialBindDisplayUrl.value.startsWith('data:image/')) return

  try {
    socialBindDisplayUrl.value = await createAuthorizeQrDataUrl(socialBindUrl.value, socialBindQrOptions)
  } catch {
    socialBindStatus.value = 'failed'
    socialBindMessage.value = '二维码图片加载失败，请重新生成'
  }
}

async function checkSocialBindStatus() {
  if (!socialBindState.value) return

  try {
    const result = await authApi.getSocialBindStatus(socialBindState.value)
    if (result.status === 'completed') {
      stopSocialBindPolling()
      socialBindStatus.value = 'success'
      socialBindMessage.value = '授权成功，第三方账号已绑定'
      MessagePlugin.success('第三方账号已绑定')
      setTimeout(async () => {
        showSocialBindDialog.value = false
        resetSocialBindQr()
        await authStore.refreshSession()
        await loadData()
      }, 900)
      return
    }

    if (result.status === 'scanned') {
      socialBindStatus.value = 'scanned'
      socialBindMessage.value = '已扫码，请继续完成确认'
      return
    }

    if (result.status === 'failed') {
      stopSocialBindPolling()
      socialBindStatus.value = 'failed'
      socialBindMessage.value = result.error || '第三方授权失败，请重新生成二维码'
      return
    }

    if (result.status === 'expired') {
      stopSocialBindPolling()
      socialBindStatus.value = 'expired'
      socialBindMessage.value = '绑定二维码已过期，请重新生成'
    }
  } catch (e: unknown) {
    stopSocialBindPolling()
    socialBindStatus.value = 'failed'
    socialBindMessage.value = (e as { message?: string })?.message || '查询绑定状态失败'
  }
}

// ── Bind social user to existing account ──
async function bindToAccount() {
  if (!bindAccountForm.value.username || !bindAccountForm.value.password) {
    return MessagePlugin.warning('请输入用户名和密码')
  }
  saving.value = true
  try {
    const res = await authApi.transferSocialBinding(
      bindAccountForm.value.username,
      bindAccountForm.value.password,
      user()?.socialAccounts?.[0]?.provider,
    )
    authStore.applySession(res)
    MessagePlugin.success('账号绑定成功')
    showBindAccount.value = false
    bindAccountForm.value = { username: '', password: '' }
    await loadData()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '绑定失败') }
  finally { saving.value = false }
}

// ── Password ──
async function setPassword() {
  if (!passwordForm.value.password) return MessagePlugin.warning('请输入新密码')
  if (passwordForm.value.password !== passwordForm.value.confirmPassword) return MessagePlugin.warning('两次密码输入不一致')
  saving.value = true
  try {
    await authApi.setPassword(passwordForm.value.password)
    MessagePlugin.success('密码已设置')
    passwordForm.value = { password: '', confirmPassword: '' }
    showPasswordSection.value = false
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '设置失败') }
  finally { saving.value = false }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="我的账号"
    >
      <template #actions>
        <NButton @click="revokeOtherSessions">注销其他设备</NButton>
        <NButton type="primary" :loading="saving" @click="saveProfile">保存资料</NButton>
      </template>
    </PageHeader>

    <div class="metric-grid">
      <MetricCard
        label="账号类型"
        :value="isSocial() ? '第三方账号' : '本地账号'"
        :caption="isSocial() ? (isBoundToUser() ? '已绑定用户账号' : '未绑定用户账号') : '用户名密码注册'"
        :trend="isSocial() ? (isBoundToUser() ? '已关联' : '待关联') : '标准'"
        :tone="isSocial() ? 'warning' : 'success'"
      />
      <MetricCard
        label="第三方绑定"
        :value="String(socialProviderCount)"
        :caption="isSocial() ? '当前为第三方账号，可绑定已有本地账号' : '已绑定的社交登录平台'"
        trend="已绑定"
        tone="info"
      />
      <MetricCard
        label="活跃会话"
        :value="String(sessionCount)"
        caption="当前设备与其他设备在线情况"
        trend="可注销"
        tone="success"
      />
      <MetricCard
        label="邮箱状态"
        :value="user()?.emailVerified ? '已验证' : '未验证'"
        caption="支持找回密码与通知邮件"
        :trend="user()?.emailVerified ? 'Verified' : 'Pending'"
        :tone="user()?.emailVerified ? 'success' : 'warning'"
      />
    </div>

    <div class="grid gap-6 xl:grid-cols-[1fr,1fr]">
      <section class="panel-card p-6">
        <p class="eyebrow">个人资料</p>
        <div class="mt-5 space-y-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <NInput v-model:value="profileForm.username" size="large" placeholder="用户名" />
            <NInput :value="user()?.email || ''" size="large" placeholder="邮箱" disabled />
          </div>
          <div class="panel-muted avatar-panel p-4">
            <NUpload
              v-model:file-list="avatarUploadFiles"
              class="avatar-upload"
              list-type="image-card"
              accept="image/*"
              :max="1"
              :default-upload="true"
              :show-file-list="true"
              :on-before-upload="beforeAvatarUpload"
              :custom-request="requestAvatarUpload"
            />
            <p class="mt-2 text-xs text-[var(--text-muted)]">点击上传图片，支持 JPG、PNG、WebP、GIF，最大 2MB</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="panel-muted p-4">
              <p class="text-sm text-[var(--text-muted)]">注册来源</p>
              <p class="mt-2 font-semibold text-[var(--text-primary)]">{{ user()?.registrationSource || '系统初始化' }}</p>
            </div>
            <div class="panel-muted p-4">
              <p class="text-sm text-[var(--text-muted)]">创建时间</p>
              <p class="mt-2 font-mono text-sm text-[var(--text-primary)]">{{ user()?.createdAt ? formatDateTime(user()!.createdAt) : '—' }}</p>
            </div>
          </div>

          <!-- Social user: bind to existing account -->
          <div v-if="isSocial() && !isBoundToUser()">
            <div v-if="!showBindAccount" class="action-row">
              <NButton type="primary" @click="showBindAccount = true">绑定已有账号</NButton>
            </div>
            <form v-else class="panel-muted p-4 space-y-4" @submit.prevent="bindToAccount">
              <p class="eyebrow">输入已有账号凭据完成绑定</p>
              <NInput v-model:value="bindAccountForm.username" size="large" placeholder="用户名" />
              <NInput v-model:value="bindAccountForm.password" type="password" size="large" placeholder="密码" />
              <div class="action-row">
                <NButton @click="showBindAccount = false">取消</NButton>
                <NButton type="primary" :loading="saving" @click="bindToAccount">确认绑定</NButton>
              </div>
            </form>
          </div>

          <div v-if="isSocial() && isBoundToUser()" class="panel-muted p-4">
            <div class="flex items-center gap-3">
              <StatusTag tone="success" label="已绑定用户" />
              <span class="text-sm text-[var(--text-primary)]">{{ user()?.boundToUser?.username || user()?.boundToUser?.email }}</span>
            </div>
          </div>

          <div v-if="!isSocial()">
            <div v-if="!showPasswordSection" class="action-row">
              <NButton @click="showPasswordSection = true">修改密码</NButton>
            </div>
            <form v-else class="panel-muted p-4 space-y-4" @submit.prevent="setPassword">
              <p class="eyebrow">设置新密码</p>
              <div class="grid gap-4 sm:grid-cols-2">
                <NInput v-model:value="passwordForm.password" type="password" size="large" placeholder="新密码" />
                <NInput v-model:value="passwordForm.confirmPassword" type="password" size="large" placeholder="确认密码" />
              </div>
              <div class="action-row">
                <NButton @click="showPasswordSection = false">取消</NButton>
                <NButton type="primary" :loading="saving" @click="setPassword">确认设置</NButton>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section class="panel-card p-6">
        <div class="page-header">
          <div>
            <p class="eyebrow">活跃会话</p>
            <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">当前设备与其他设备</h2>
          </div>
          <StatusTag tone="warning" label="注销当前会话会退出登录" />
        </div>

        <div class="mt-5 max-h-[400px] overflow-y-auto space-y-3 pr-1">
          <div v-for="session in sessions" :key="session.id" class="panel-muted p-4 flex items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-semibold text-[var(--text-primary)]">{{ session.clientName || '未知设备' }}</p>
                <StatusTag :tone="session.current ? 'success' : 'neutral'" :label="session.current ? '当前设备' : '其他设备'" />
              </div>
              <p class="mt-1.5 text-xs text-[var(--text-muted)]">{{ parseBrowser(session.userAgent) }} · {{ formatDateTime(session.createdAt) }}</p>
              <p class="mt-1 break-all font-mono text-xs text-[var(--text-muted)]">{{ session.scopes.join(' ') }}</p>
            </div>
            <NButton v-if="!session.current" size="small" type="error" @click="revokeSession(session.id)">注销</NButton>
          </div>
          <div v-if="sessions.length === 0 && !loading" class="panel-muted p-4 text-center">
            <p class="text-sm text-[var(--text-muted)]">暂无活跃会话</p>
          </div>
        </div>
      </section>
    </div>

    <section class="panel-card p-6">
      <div class="page-header">
        <div>
          <p class="eyebrow">应用接入</p>
          <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">我的应用</h2>
          <p class="mt-1 text-sm text-[var(--text-muted)]">用户可提交接入应用，管理员在后台启用或禁用运行状态。</p>
        </div>
        <NButton type="primary" @click="openApplicationDialog">添加应用</NButton>
      </div>

      <div v-if="createdApplication" class="mt-5 rounded-2xl border border-[rgba(245,158,11,0.18)] bg-[rgba(245,158,11,0.08)] p-4">
        <p class="text-sm font-semibold text-[var(--warning)]">请立即保存 Client Secret</p>
        <p class="mt-2 break-all font-mono text-xs text-[var(--text-primary)]">Client ID: {{ createdApplication.clientId }}</p>
        <p class="mt-1 break-all font-mono text-xs text-[var(--text-primary)]">Client Secret: {{ createdApplication.clientSecret }}</p>
      </div>

      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        <div v-for="app in applications" :key="app.id" class="panel-muted p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-[var(--text-primary)]">{{ app.name }}</p>
              <p class="mt-1 break-all font-mono text-xs text-[var(--text-muted)]">{{ app.clientId }}</p>
            </div>
            <StatusTag :tone="app.status === 'active' ? 'success' : 'danger'" :label="app.status === 'active' ? '允许运行' : '禁止运行'" />
          </div>
          <p class="mt-3 truncate text-xs text-[var(--text-muted)]">{{ app.redirectUris[0] || '未配置回调地址' }}</p>
          <div v-if="app.scopes.length" class="mt-2 flex flex-wrap gap-1">
            <span v-for="scope in app.scopes" :key="scope" class="token-chip text-xs" :title="scope">{{ scopeLabel(scope) }}</span>
          </div>
        </div>
        <div v-if="applications.length === 0 && !loading" class="panel-muted p-4 text-center">
          <p class="text-sm text-[var(--text-muted)]">暂无自助接入应用</p>
        </div>
      </div>
    </section>

    <NModal
      v-model:show="showApplicationForm"
      preset="card"
      title="添加应用"
      style="width: 620px"
    >
      <div class="account-app-dialog">
        <div class="account-app-grid">
          <label class="app-form-field">
            <span>应用名称</span>
              <NInput v-model:value="applicationForm.name" size="large" placeholder="例如 一证通行业务系统" />
          </label>
          <label class="app-form-field">
            <span>应用描述</span>
            <NInput v-model:value="applicationForm.description" size="large" placeholder="描述（可选）" />
          </label>
        </div>
        <label class="app-form-field">
          <span>回调地址</span>
          <NInput
            v-model:value="applicationForm.redirectUris"
            type="textarea"
            placeholder="每行一个，例如 http://localhost:5173/oauth/callback"
            :autosize="{ minRows: 3, maxRows: 5 }"
          />
        </label>
        <label class="app-form-field">
          <span>Scope 权限</span>
          <NSelect
            v-model:value="applicationForm.scopes"
            :options="APPLICATION_SCOPE_OPTIONS"
            placeholder="选择应用可申请的用户信息"
            multiple
            size="large"
            :max-tag-count="3"
          />
        </label>
        <div class="app-dialog-option">
          <div>
            <p>允许注册</p>
            <span>允许从该应用授权流程注册新用户</span>
          </div>
          <NSwitch v-model:value="applicationForm.allowRegistration" />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showApplicationForm = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="createApplication">提交应用</NButton>
        </div>
      </template>
    </NModal>

    <!-- Social Bindings Section — only for non-social users -->
    <section v-if="!isSocial()" class="panel-card p-6">
      <div class="page-header">
        <div>
          <p class="eyebrow">第三方绑定</p>
          <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">已绑定平台</h2>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <StatusTag tone="danger" label="解绑需要二次确认" />
          <NDropdown v-if="availableBindProviders.length > 0" :options="availableBindDropdownOptions" trigger="click" @select="handleSocialProviderDropdownSelect">
            <NButton type="primary">添加绑定</NButton>
          </NDropdown>
        </div>
      </div>

      <div class="mt-5 grid gap-4 lg:grid-cols-3">
        <div v-for="binding in bindings" :key="binding.id" class="panel-muted p-5">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-semibold text-[var(--text-primary)]">{{ binding.provider }}</p>
            <StatusTag tone="info" label="已绑定" />
          </div>
          <p class="mt-4 break-all font-mono text-xs text-[var(--text-muted)]">{{ binding.providerUserId }}</p>
          <p class="mt-3 text-sm text-[var(--text-muted)]">绑定时间：{{ formatDateTime(binding.createdAt) }}</p>
          <div class="action-row mt-4">
            <NButton type="error" ghost @click="unbindSocial(binding.provider)">解绑</NButton>
          </div>
        </div>
        <div v-if="bindings.length === 0 && !loading" class="col-span-full panel-muted p-4 text-center">
          <p class="text-sm text-[var(--text-muted)]">暂无第三方绑定，可点击「添加绑定」扫码授权</p>
        </div>
      </div>
    </section>

    <!-- Social User: bind to account section -->
    <section v-if="isSocial()" class="panel-card p-6">
      <div class="page-header">
        <div>
          <p class="eyebrow">账号关联</p>
          <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">第三方账号关联</h2>
        </div>
        <StatusTag :tone="isBoundToUser() ? 'success' : 'warning'" :label="isBoundToUser() ? '已关联用户' : '未关联用户'" />
      </div>

      <div class="mt-5 space-y-4">
        <div v-if="user()?.socialAccounts" class="grid gap-4 lg:grid-cols-2">
          <div v-for="sa in user()?.socialAccounts" :key="sa.provider" class="panel-muted p-4">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-semibold text-[var(--text-primary)]">{{ sa.provider }}</p>
              <StatusTag tone="info" label="当前登录来源" />
            </div>
            <p class="mt-3 break-all font-mono text-xs text-[var(--text-muted)]">{{ sa.providerUserId }}</p>
          </div>
        </div>

        <div v-if="!isBoundToUser()" class="rounded-2xl border border-[rgba(245,158,11,0.15)] bg-[rgba(245,158,11,0.08)] p-4">
          <p class="text-sm font-semibold text-[var(--warning)]">当前为第三方注册账号</p>
          <p class="mt-1 text-sm leading-6 text-[var(--text-muted)]">可在上方「个人资料」区域输入已有账号凭据完成绑定。绑定后将以用户账号身份登录，第三方作为登录方式。</p>
        </div>
      </div>
    </section>

    <NModal
      v-model:show="showSocialBindDialog"
      preset="card"
      :title="`${providerLabel(selectedBindProvider)} 扫码绑定`"
      style="width: 430px"
      @close="resetSocialBindQr"
    >
      <div class="space-y-4 pt-2 text-center">
        <div class="relative mx-auto grid min-h-[250px] w-[250px] place-items-center rounded-3xl border border-[var(--border-primary)] bg-white p-3">
          <img v-if="socialBindDisplayUrl" :src="socialBindDisplayUrl" alt="第三方绑定二维码" class="h-[230px] w-[230px] rounded-2xl object-contain" @error="handleSocialBindQrImageError" />
          <div v-else class="grid h-[230px] w-[230px] place-items-center rounded-2xl bg-slate-50 text-sm text-slate-500">二维码生成中...</div>
          <div
            v-if="socialBindStatus === 'success' || socialBindStatus === 'failed' || socialBindStatus === 'expired'"
            class="absolute inset-3 grid place-items-center rounded-2xl bg-white/92 backdrop-blur-sm"
          >
            <div class="space-y-2">
              <div
                :class="[
                  'mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl font-bold text-white',
                  socialBindStatus === 'success' ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'
                ]"
              >
                {{ socialBindStatus === 'success' ? '✓' : '!' }}
              </div>
              <p class="text-sm font-semibold text-slate-900">
                {{ socialBindStatus === 'success' ? '授权成功' : socialBindStatus === 'expired' ? '二维码过期' : '授权失败' }}
              </p>
            </div>
          </div>
        </div>
        <p class="text-sm font-semibold text-[var(--text-primary)]">{{ socialBindMessage }}</p>
        <p v-if="socialBindStatus === 'pending'" class="text-xs text-[var(--text-muted)]">请扫码并在手机完成授权，当前页面不会跳转，会自动更新绑定状态。</p>
        <div v-if="socialBindStatus === 'failed' || socialBindStatus === 'expired'" class="action-row justify-center">
          <NButton @click="showSocialBindDialog = false; resetSocialBindQr()">关闭</NButton>
          <NButton type="primary" @click="openSocialBindQr(selectedBindProvider)">重新生成</NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.avatar-panel {
  display: inline-flex;
  align-items: flex-start;
  width: auto;
}

.account-app-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}

.account-app-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.app-form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-form-field > span {
  margin-left: 4px;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.app-dialog-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid var(--border-primary);
  border-radius: 1.25rem;
  background: var(--surface-muted);
  padding: 16px;
}

.app-dialog-option p {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 800;
}

.app-dialog-option span {
  display: block;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .account-app-grid {
    grid-template-columns: 1fr;
  }
}
</style>
