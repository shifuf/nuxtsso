<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'
import type { AccountSession, SocialAccountBinding } from '../../types/api'
import MetricCard from '../../components/MetricCard.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'

const authStore = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const sessions = ref<AccountSession[]>([])
const bindings = ref<SocialAccountBinding[]>([])

const profileForm = ref({ username: '', avatar: '' })
const passwordForm = ref({ password: '', confirmPassword: '' })
const showPasswordSection = ref(false)

const bindAccountForm = ref({ username: '', password: '' })
const showBindAccount = ref(false)

// ── Helpers ──
const user = () => authStore.user
const isSocial = () => {
  const u = user()
  if (!u) return false
  return Boolean(
    (u.socialAccounts && u.socialAccounts.length > 0) ||
    u.registrationSource?.includes('social') ||
    u.registrationSource?.includes('第三方') ||
    u.registrationSource?.includes('wechat') ||
    u.registrationSource?.includes('github') ||
    u.registrationSource?.includes('google') ||
    u.registrationSource?.includes('qq')
  )
}
const isBoundToUser = () => Boolean(user()?.boundToUser)

const socialProviderCount = ref(0)
const sessionCount = ref(0)

onMounted(async () => {
  await loadData()
})

async function loadData() {
  loading.value = true
  try {
    const [sessionsRes, bindingsRes] = await Promise.all([
      authApi.listSessions(),
      authApi.listSocialBindings(),
    ])
    sessions.value = sessionsRes
    bindingsRes && (bindings.value = bindingsRes)

    const u = user()
    if (u) {
      profileForm.value.username = u.username || ''
      profileForm.value.avatar = u.avatar || ''
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
      avatar: profileForm.value.avatar || null,
    })
    await authStore.refreshSession()
    MessagePlugin.success('资料已更新')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '更新失败') }
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
      eyebrow="用户自助"
      title="我的账号"
      description="集中展示个人资料、会话、第三方绑定和安全状态。涉及解绑或清理会话的动作需要明确后果。"
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
          <t-input v-model="profileForm.avatar" size="large" placeholder="头像 URL" />
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="panel-muted p-4">
              <p class="text-sm text-[var(--text-muted)]">注册来源</p>
              <p class="mt-2 font-semibold text-[var(--text-primary)]">{{ user()?.registrationSource || '系统初始化' }}</p>
            </div>
            <div class="panel-muted p-4">
              <p class="text-sm text-[var(--text-muted)]">创建时间</p>
              <p class="mt-2 font-mono text-sm text-[var(--text-primary)]">{{ user()?.createdAt || '—' }}</p>
            </div>
          </div>

          <!-- Social user: bind to existing account -->
          <div v-if="isSocial() && !isBoundToUser()">
            <div v-if="!showBindAccount" class="action-row">
              <t-button theme="primary" @click="showBindAccount = true">绑定已有账号</t-button>
            </div>
            <div v-else class="panel-muted p-4 space-y-4">
              <p class="eyebrow">输入已有账号凭据完成绑定</p>
              <t-input v-model="bindAccountForm.username" size="large" placeholder="用户名" />
              <t-input v-model="bindAccountForm.password" type="password" size="large" placeholder="密码" />
              <div class="action-row">
                <t-button variant="outline" @click="showBindAccount = false">取消</t-button>
                <t-button theme="primary" :loading="saving" @click="bindToAccount">确认绑定</t-button>
              </div>
            </div>
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
            <div v-else class="panel-muted p-4 space-y-4">
              <p class="eyebrow">设置新密码</p>
              <div class="grid gap-4 sm:grid-cols-2">
                <t-input v-model="passwordForm.password" type="password" size="large" placeholder="新密码" />
                <t-input v-model="passwordForm.confirmPassword" type="password" size="large" placeholder="确认密码" />
              </div>
              <div class="action-row">
                <t-button variant="outline" @click="showPasswordSection = false">取消</t-button>
                <t-button theme="primary" :loading="saving" @click="setPassword">确认设置</t-button>
              </div>
            </div>
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

        <div class="stack-list mt-5">
          <div v-for="session in sessions" :key="session.id" class="panel-muted stack-item">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-semibold text-[var(--text-primary)]">{{ session.clientName || '未知设备' }}</p>
                <StatusTag :tone="session.current ? 'success' : 'neutral'" :label="session.current ? '当前设备' : '其他设备'" />
              </div>
              <p class="mt-2 break-all font-mono text-xs text-[var(--text-muted)]">{{ session.scopes.join(' ') }}</p>
              <p class="mt-2 text-sm text-[var(--text-muted)]">到期时间：{{ session.expiresAt }}</p>
            </div>
            <t-button v-if="!session.current" variant="outline" size="small" theme="danger" @click="revokeSession(session.id)">注销</t-button>
          </div>
          <div v-if="sessions.length === 0 && !loading" class="panel-muted p-4 text-center">
            <p class="text-sm text-[var(--text-muted)]">暂无活跃会话</p>
          </div>
        </div>
      </section>
    </div>

    <!-- Social Bindings Section — only for non-social users -->
    <section v-if="!isSocial()" class="panel-card p-6">
      <div class="page-header">
        <div>
          <p class="eyebrow">第三方绑定</p>
          <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">已绑定平台</h2>
        </div>
        <StatusTag tone="danger" label="解绑需要二次确认" />
      </div>

      <div class="mt-5 grid gap-4 lg:grid-cols-3">
        <div v-for="binding in bindings" :key="binding.id" class="panel-muted p-5">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-semibold text-[var(--text-primary)]">{{ binding.provider }}</p>
            <StatusTag tone="info" label="已绑定" />
          </div>
          <p class="mt-4 break-all font-mono text-xs text-[var(--text-muted)]">{{ binding.providerUserId }}</p>
          <p class="mt-3 text-sm text-[var(--text-muted)]">绑定时间：{{ binding.createdAt }}</p>
          <div class="action-row mt-4">
            <t-button variant="outline" theme="danger" @click="unbindSocial(binding.provider)">解绑</t-button>
          </div>
        </div>
        <div v-if="bindings.length === 0 && !loading" class="col-span-full panel-muted p-4 text-center">
          <p class="text-sm text-[var(--text-muted)]">暂无第三方绑定，可在登录页通过第三方入口绑定</p>
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
  </div>
</template>
