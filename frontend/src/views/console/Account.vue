<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'
import type { AccountSession, SocialAccountBinding, ApplicationItem, ApplicationCreateResponse } from '../../types/api'
import { formatDateTime, parseBrowser } from '../../utils/console'
import { createAuthorizeQrDataUrl, createQrDisplayUrl } from '../../utils/qrcode'
import MetricCard from '../../components/MetricCard.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'

const authStore = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const sessions = ref<AccountSession[]>([])
const bindings = ref<SocialAccountBinding[]>([])
const socialProviders = ref<Array<{ name: string; enabled: boolean }>>([])
const applications = ref<ApplicationItem[]>([])
const createdApplication = ref<ApplicationCreateResponse | null>(null)

const profileForm = ref({ username: '' })
const avatarFile = ref<File | null>(null)
const avatarPreview = ref('')
const passwordForm = ref({ password: '', confirmPassword: '' })
const showPasswordSection = ref(false)
const showApplicationForm = ref(false)
const applicationForm = ref({
  name: '',
  description: '',
  redirectUris: '',
  scopes: 'openid\nprofile\nemail',
  allowRegistration: true,
})

const bindAccountForm = ref({ username: '', password: '' })
const showBindAccount = ref(false)
const showSocialBindDialog = ref(false)
const selectedBindProvider = ref('')
const socialBindUrl = ref('')
const socialBindDisplayUrl = ref('')
const socialBindState = ref('')
const socialBindStatus = ref<'idle' | 'pending' | 'success' | 'failed' | 'expired'>('idle')
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
  return socialProviders.value.filter(item => item.enabled && !bound.has(item.name))
})

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
    socialProviders.value = providersRes
    applications.value = await authApi.listAccountApplications()

    const u = user()
    if (u) {
      profileForm.value.username = u.username || ''
      avatarPreview.value = u.avatar || ''
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

function onAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    MessagePlugin.warning('请选择图片文件')
    return
  }
  avatarFile.value = file
  avatarPreview.value = URL.createObjectURL(file)
}

async function uploadAvatar() {
  if (!avatarFile.value) return MessagePlugin.warning('请选择头像文件')
  saving.value = true
  try {
    await authApi.uploadAvatar(avatarFile.value)
    await authStore.refreshSession()
    avatarFile.value = null
    avatarPreview.value = user()?.avatar || ''
    MessagePlugin.success('头像已更新')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '上传失败') }
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
      scopes: applicationForm.value.scopes.split('\n').map(s => s.trim()).filter(Boolean),
      allowRegistration: applicationForm.value.allowRegistration,
    })
    createdApplication.value = result
    applications.value = await authApi.listAccountApplications()
    showApplicationForm.value = false
    applicationForm.value = {
      name: '',
      description: '',
      redirectUris: '',
      scopes: 'openid\nprofile\nemail',
      allowRegistration: true,
    }
    MessagePlugin.success('应用已创建，等待管理员审核启用')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '创建失败') }
  finally { saving.value = false }
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
    body: `确定要解除 ${provider} 的第三方绑定吗？解绑后将无法通过 ${provider} 登录。`,
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

function handleSocialProviderDropdownClick(option: { value: string | number }) {
  void openSocialBindQr(String(option.value))
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
    const result = await authApi.createSocialBind(provider, '/console/account')
    socialBindUrl.value = result.authorizeUrl
    socialBindState.value = result.state
    socialBindMessage.value = '等待扫码/授权'
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
    // Use the first social provider to transfer binding
    const provider = user()?.socialAccounts?.[0]?.provider
    if (!provider) return MessagePlugin.warning('未找到第三方账号信息')
    await authApi.transferSocialBinding(provider, bindAccountForm.value.username, bindAccountForm.value.password)
    await authStore.refreshSession()
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
        <t-button variant="outline" @click="revokeOtherSessions">注销其他设备</t-button>
        <t-button theme="primary" :loading="saving" @click="saveProfile">保存资料</t-button>
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
            <t-input v-model="profileForm.username" size="large" placeholder="用户名" />
            <t-input :value="user()?.email || ''" size="large" placeholder="邮箱" disabled />
          </div>
          <div class="panel-muted p-4">
            <div class="flex flex-wrap items-center gap-4">
              <img
                v-if="avatarPreview"
                :src="avatarPreview"
                alt="当前头像"
                class="h-16 w-16 rounded-2xl object-cover"
              />
              <div v-else class="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--surface-primary)] text-lg font-semibold text-[var(--text-primary)]">
                {{ (user()?.username || user()?.email || 'U')[0] }}
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-[var(--text-primary)]">上传头像</p>
                <p class="mt-1 text-xs text-[var(--text-muted)]">支持 JPG、PNG、WebP、GIF，最大 2MB。</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <input type="file" accept="image/*" class="text-sm text-[var(--text-muted)]" @change="onAvatarChange" />
                  <t-button size="small" theme="primary" :loading="saving" :disabled="!avatarFile" @click="uploadAvatar">上传头像</t-button>
                </div>
              </div>
            </div>
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
              <t-button theme="primary" @click="showBindAccount = true">绑定已有账号</t-button>
            </div>
            <form v-else class="panel-muted p-4 space-y-4" @submit.prevent="bindToAccount">
              <p class="eyebrow">输入已有账号凭据完成绑定</p>
              <t-input v-model="bindAccountForm.username" size="large" placeholder="用户名" />
              <t-input v-model="bindAccountForm.password" type="password" size="large" placeholder="密码" />
              <div class="action-row">
                <t-button variant="outline" @click="showBindAccount = false">取消</t-button>
                <t-button theme="primary" :loading="saving" @click="bindToAccount">确认绑定</t-button>
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
              <t-button variant="outline" @click="showPasswordSection = true">修改密码</t-button>
            </div>
            <form v-else class="panel-muted p-4 space-y-4" @submit.prevent="setPassword">
              <p class="eyebrow">设置新密码</p>
              <div class="grid gap-4 sm:grid-cols-2">
                <t-input v-model="passwordForm.password" type="password" size="large" placeholder="新密码" />
                <t-input v-model="passwordForm.confirmPassword" type="password" size="large" placeholder="确认密码" />
              </div>
              <div class="action-row">
                <t-button variant="outline" @click="showPasswordSection = false">取消</t-button>
                <t-button theme="primary" :loading="saving" @click="setPassword">确认设置</t-button>
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
            <t-button v-if="!session.current" variant="outline" size="small" theme="danger" @click="revokeSession(session.id)">注销</t-button>
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
        <t-button theme="primary" @click="showApplicationForm = !showApplicationForm">{{ showApplicationForm ? '取消' : '添加应用' }}</t-button>
      </div>

      <form v-if="showApplicationForm" class="mt-5 panel-muted p-4 space-y-4" @submit.prevent="createApplication">
        <div class="grid gap-4 sm:grid-cols-2">
          <t-input v-model="applicationForm.name" size="large" placeholder="应用名称" />
          <t-input v-model="applicationForm.description" size="large" placeholder="描述（可选）" />
        </div>
        <t-textarea
          v-model="applicationForm.redirectUris"
          placeholder="回调地址（每行一个，例如 http://localhost:5173/oauth/callback）"
          :autosize="{ minRows: 2, maxRows: 4 }"
        />
        <t-textarea
          v-model="applicationForm.scopes"
          placeholder="Scope（每行一个）"
          :autosize="{ minRows: 2, maxRows: 4 }"
        />
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-[var(--text-primary)]">允许从该应用注册新用户</span>
          <t-switch v-model="applicationForm.allowRegistration" />
        </div>
        <div class="action-row">
          <t-button theme="primary" :loading="saving" @click="createApplication">提交应用</t-button>
        </div>
      </form>

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
        </div>
        <div v-if="applications.length === 0 && !loading" class="panel-muted p-4 text-center">
          <p class="text-sm text-[var(--text-muted)]">暂无自助接入应用</p>
        </div>
      </div>
    </section>

    <!-- Social Bindings Section — only for non-social users -->
    <section v-if="!isSocial()" class="panel-card p-6">
      <div class="page-header">
        <div>
          <p class="eyebrow">第三方绑定</p>
          <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">已绑定平台</h2>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <StatusTag tone="danger" label="解绑需要二次确认" />
          <t-dropdown v-if="availableBindProviders.length > 0" :options="availableBindProviders.map(item => ({ content: providerLabel(item.name), value: item.name }))" @click="handleSocialProviderDropdownClick">
            <t-button theme="primary">添加绑定</t-button>
          </t-dropdown>
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
            <t-button variant="outline" theme="danger" @click="unbindSocial(binding.provider)">解绑</t-button>
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

    <t-dialog
      v-model:visible="showSocialBindDialog"
      :header="`${providerLabel(selectedBindProvider)} 扫码绑定`"
      width="430px"
      :footer="false"
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
          <t-button variant="outline" @click="showSocialBindDialog = false; resetSocialBindQr()">关闭</t-button>
          <t-button theme="primary" @click="openSocialBindQr(selectedBindProvider)">重新生成</t-button>
        </div>
      </div>
    </t-dialog>
  </div>
</template>
