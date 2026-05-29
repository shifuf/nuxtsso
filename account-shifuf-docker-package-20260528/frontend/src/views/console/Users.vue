<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { NButton, NInput, NSelect, NModal } from 'naive-ui'
import { MessagePlugin, DialogPlugin } from '../../utils/ui'
import { adminApi } from '../../api/admin'
import type { UserProfile, SocialAccountItem, SocialProviderConfig } from '../../types/api'
import { createAuthorizeQrDataUrl, createQrDisplayUrl } from '../../utils/qrcode'
import MetricCard from '../../components/MetricCard.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'

const loading = ref(false)
const saving = ref(false)
const users = ref<UserProfile[]>([])
const allSocialAccounts = ref<SocialAccountItem[]>([])

const searchQuery = ref('')
const roleFilter = ref<'全部' | 'admin' | 'user'>('全部')
const statusFilter = ref<'全部' | 'active' | 'disabled'>('全部')

const showUserDialog = ref(false)
const showPasswordDialog = ref(false)
const showSocialDialog = ref(false)
const editingUser = ref<UserProfile | null>(null)
const passwordTargetId = ref('')
const newPassword = ref('')
const bindTargetUser = ref<UserProfile | null>(null)

const userForm = reactive({
  email: '',
  username: '',
  password: '',
  status: 'active' as 'active' | 'disabled',
})

const socialSearch = ref('')
const selectedSocial = ref<SocialAccountItem | null>(null)

// Bind user dialog (for social users)
const showUserBindDialog = ref(false)
const userBindTarget = ref<UserProfile | null>(null)
const userBindUsername = ref('')
const bindableUsers = ref<UserProfile[]>([])
const selectedBindUser = ref<UserProfile | null>(null)
let bindUserSearchTimer: ReturnType<typeof setTimeout> | null = null

// Social bind mode: 'input' = enter ID, 'qrcode' = scan QR code
const socialBindMode = ref<'input' | 'qrcode'>('input')
const enabledProviders = ref<SocialProviderConfig[]>([])
const selectedQrProvider = ref<SocialProviderConfig | null>(null)
const socialBindUrl = ref('')
const socialBindDisplayUrl = ref('')
const socialBindState = ref('')
const socialBindPolling = ref(false)
const socialBindStatus = ref<'idle' | 'pending' | 'success' | 'failed' | 'expired'>('idle')
const socialBindMessage = ref('')
let socialBindPollTimer: ReturnType<typeof setInterval> | null = null
const socialBindQrOptions = {
  width: 220,
  margin: 2,
  dark: '#1a1a2e',
  light: '#ffffff',
}

const adminCount = computed(() => users.value.filter(u => u.role === 'admin').length)
const verifiedCount = computed(() => users.value.filter(u => u.emailVerified).length)
const disabledCount = computed(() => users.value.filter(u => u.status === 'disabled').length)

const filteredUsers = computed(() => {
  let result = users.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(u =>
      (u.email?.toLowerCase().includes(q)) ||
      (u.username?.toLowerCase().includes(q)) ||
      u.id.toLowerCase().includes(q)
    )
  }
  if (roleFilter.value !== '全部') result = result.filter(u => u.role === roleFilter.value)
  if (statusFilter.value !== '全部') result = result.filter(u => u.status === statusFilter.value)
  return result
})

const roleOptions = [
  { label: '全部角色', value: '全部' },
  { label: '管理员', value: 'admin' },
  { label: '用户', value: 'user' },
]

const statusOptions = [
  { label: '全部状态', value: '全部' },
  { label: '启用', value: 'active' },
  { label: '禁用', value: 'disabled' },
]

const userStatusOptions = [
  { label: '启用', value: 'active' },
  { label: '禁用', value: 'disabled' },
]

const socialRegistrationSources = [
  'wechat',
  'qq',
  'github',
  'google',
  'alipay',
  'weibo',
  'baidu',
  'huawei',
  'xiaomi',
  'douyin',
  'bilibili',
  'dingtalk',
]

function isSocialUser(user: UserProfile) {
  const source = user.registrationSource?.toLowerCase() || ''
  return Boolean(
    user.email?.endsWith('@social.local') &&
      (source.includes('social') || socialRegistrationSources.includes(source))
  )
}

function isAdminUser(user: UserProfile) {
  return user.role === 'admin'
}

function hasDeleteBlocker(user: UserProfile) {
  if (isAdminUser(user)) return true
  if (isSocialUser(user)) return Boolean(user.boundToUser)
  return Boolean(user.socialAccounts?.length)
}

function deleteBlockerText(user: UserProfile) {
  if (isAdminUser(user)) return '管理员账号不允许删除'
  if (isSocialUser(user) && user.boundToUser) return '请先解除绑定用户关系'
  if (!isSocialUser(user) && user.socialAccounts?.length) return '请先解除第三方绑定'
  return ''
}

function isRegularUser(user: UserProfile) {
  return !isSocialUser(user)
}

const filteredSocialAccounts = computed(() => {
  if (!socialSearch.value) return []
  const q = socialSearch.value.toLowerCase()
  return allSocialAccounts.value.filter(sa => {
    if (!sa.available) return false
    return sa.provider.toLowerCase().includes(q) ||
           sa.providerUserId.toLowerCase().includes(q) ||
           (sa.boundEmail?.toLowerCase().includes(q)) ||
           (sa.boundUsername?.toLowerCase().includes(q))
  })
})

onMounted(async () => {
  await loadUsers()
})

onUnmounted(() => {
  stopSocialBindPolling()
  if (bindUserSearchTimer) clearTimeout(bindUserSearchTimer)
})

watch(userBindUsername, (value) => {
  selectedBindUser.value = null
  if (bindUserSearchTimer) clearTimeout(bindUserSearchTimer)

  const query = value.trim()
  if (!query) {
    bindableUsers.value = []
    return
  }

  bindUserSearchTimer = setTimeout(() => {
    void searchBindableUsers()
  }, 300)
})

async function loadUsers() {
  loading.value = true
  try {
    users.value = await adminApi.listUsers()
  } catch { /* silent */ }
  finally { loading.value = false }
}

// ── User CRUD ──
function openCreate() {
  editingUser.value = null
  userForm.email = ''
  userForm.username = ''
  userForm.password = ''
  userForm.status = 'active'
  showUserDialog.value = true
}

function openEdit(user: UserProfile) {
  editingUser.value = user
  userForm.email = user.email || ''
  userForm.username = user.username || ''
  userForm.password = ''
  userForm.status = user.status
  showUserDialog.value = true
}

async function saveUser() {
  if (!userForm.email) return MessagePlugin.warning('请输入邮箱')
  saving.value = true
  try {
    if (editingUser.value) {
      await adminApi.updateUser(editingUser.value.id, {
        username: userForm.username || undefined,
      })
      if (editingUser.value.status !== userForm.status && editingUser.value.role !== 'admin') {
        await adminApi.updateUserStatus(editingUser.value.id, userForm.status)
      }
      MessagePlugin.success('用户已更新')
    } else {
      if (!userForm.password) return MessagePlugin.warning('请输入密码')
      await adminApi.createUser({
        email: userForm.email,
        username: userForm.username || undefined,
        password: userForm.password,
      })
      MessagePlugin.success('用户已创建')
    }
    showUserDialog.value = false
    await loadUsers()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
}

async function deleteUser(user: UserProfile) {
  const blockerText = deleteBlockerText(user)
  if (blockerText) return MessagePlugin.warning(blockerText)

  const dialog = DialogPlugin.confirm({
    header: '删除用户',
    body: `确定要删除 "${user.username || user.email}" 吗？该操作不可撤销。`,
    confirmBtn: '确认删除',
    cancelBtn: '取消',
    theme: 'danger',
    onConfirm: async () => {
      try {
        await adminApi.deleteUser(user.id)
        MessagePlugin.success('用户已删除')
        await loadUsers()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '删除失败') }
      dialog.hide()
    },
  })
}

async function toggleStatus(user: UserProfile) {
  if (isAdminUser(user)) return MessagePlugin.warning('管理员账号不允许禁用')
  const newStatus = user.status === 'active' ? 'disabled' : 'active'
  try {
    await adminApi.updateUserStatus(user.id, newStatus)
    MessagePlugin.success(newStatus === 'active' ? '用户已启用' : '用户已禁用')
    await loadUsers()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '操作失败') }
}

function openPasswordReset(userId: string) {
  passwordTargetId.value = userId
  newPassword.value = ''
  showPasswordDialog.value = true
}

async function resetPassword(newPw: string) {
  if (!newPw) return MessagePlugin.warning('请输入新密码')
  saving.value = true
  try {
    await adminApi.resetUserPassword(passwordTargetId.value, newPw)
    MessagePlugin.success('密码已重置')
    showPasswordDialog.value = false
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '重置失败') }
  finally { saving.value = false }
}

// ── Social Binding ──
async function openSocialBind(user: UserProfile) {
  bindTargetUser.value = user
  socialSearch.value = ''
  selectedSocial.value = null
  socialBindMode.value = 'input'
  selectedQrProvider.value = null
  socialBindUrl.value = ''
  socialBindDisplayUrl.value = ''
  socialBindState.value = ''
  socialBindStatus.value = 'idle'
  socialBindMessage.value = ''
  stopSocialBindPolling()

  try {
    const [accounts, providers] = await Promise.all([
      adminApi.listAllSocialAccounts(),
      adminApi.listSocialProviders(),
    ])
    allSocialAccounts.value = accounts
    enabledProviders.value = providers.filter(p => p.enabled)
  } catch { /* silent */ }
  showSocialDialog.value = true
}

function switchSocialBindMode(mode: 'input' | 'qrcode') {
  socialBindMode.value = mode
  selectedQrProvider.value = null
  socialBindUrl.value = ''
  socialBindDisplayUrl.value = ''
  socialBindState.value = ''
  socialBindStatus.value = 'idle'
  socialBindMessage.value = ''
  stopSocialBindPolling()
}

async function selectQrProvider(provider: SocialProviderConfig) {
  if (!bindTargetUser.value) return
  selectedQrProvider.value = provider
  socialBindUrl.value = ''
  socialBindDisplayUrl.value = ''
  try {
    socialBindStatus.value = 'pending'
    socialBindMessage.value = '正在生成绑定二维码...'
    const result = await adminApi.generateSocialBindUrl(bindTargetUser.value.id, provider.name)
    socialBindUrl.value = result.authorizeUrl
    socialBindState.value = result.state
    socialBindMessage.value = '等待扫码/授权'
    socialBindDisplayUrl.value = await createQrDisplayUrl(
      socialBindUrl.value,
      result.qrCodeUrl,
      socialBindQrOptions,
    )
    startSocialBindPolling()
  } catch (e: unknown) {
    socialBindStatus.value = 'expired'
    socialBindMessage.value = (e as { message?: string })?.message || '生成二维码失败'
    MessagePlugin.error((e as { message?: string })?.message || '生成二维码失败')
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

function stopSocialBindPolling() {
  if (socialBindPollTimer) {
    clearInterval(socialBindPollTimer)
    socialBindPollTimer = null
  }
  socialBindPolling.value = false
}

function startSocialBindPolling() {
  stopSocialBindPolling()
  if (!bindTargetUser.value || !socialBindState.value) return

  socialBindPolling.value = true
  socialBindPollTimer = setInterval(() => {
    void checkSocialBindStatus()
  }, 1800)
  void checkSocialBindStatus()
}

async function checkSocialBindStatus() {
  if (!bindTargetUser.value || !socialBindState.value) return

  try {
    const result = await adminApi.getSocialBindStatus(bindTargetUser.value.id, socialBindState.value)
    if (result.status === 'completed') {
      stopSocialBindPolling()
      socialBindStatus.value = 'success'
      socialBindMessage.value = '授权已完成，第三方账号已绑定'
      MessagePlugin.success('扫码授权已完成，第三方账号已绑定')
      setTimeout(async () => {
        showSocialDialog.value = false
        resetSocialBindDialog()
        await loadUsers()
      }, 900)
    } else if (result.status === 'expired') {
      stopSocialBindPolling()
      socialBindStatus.value = 'expired'
      socialBindMessage.value = '绑定二维码已过期，请重新生成'
      MessagePlugin.warning('绑定二维码已过期，请重新生成')
    } else if (result.status === 'failed') {
      stopSocialBindPolling()
      socialBindStatus.value = 'failed'
      socialBindMessage.value = result.error || '第三方授权失败，请重新生成'
      MessagePlugin.error(socialBindMessage.value)
    }
  } catch (e: unknown) {
    stopSocialBindPolling()
    MessagePlugin.error((e as { message?: string })?.message || '查询绑定状态失败')
  }
}

function resetSocialBindDialog() {
  socialSearch.value = ''
  selectedSocial.value = null
  socialBindMode.value = 'input'
  selectedQrProvider.value = null
  socialBindUrl.value = ''
  socialBindDisplayUrl.value = ''
  socialBindState.value = ''
  socialBindStatus.value = 'idle'
  socialBindMessage.value = ''
  stopSocialBindPolling()
}

async function bindSocial() {
  if (!selectedSocial.value) return MessagePlugin.warning('请选择一个第三方账号')
  saving.value = true
  try {
    await adminApi.bindUserSocialAccount(
      bindTargetUser.value!.id,
      selectedSocial.value.provider,
      selectedSocial.value.providerUserId,
    )
    MessagePlugin.success('第三方账号已绑定')
    showSocialDialog.value = false
    await loadUsers()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '绑定失败') }
  finally { saving.value = false }
}

async function unbindSocial(userId: string, provider: string) {
  const dialog = DialogPlugin.confirm({
    header: '解除绑定',
    body: `确定要解除该用户的 ${provider} 绑定吗？解绑后双方可重新绑定。`,
    confirmBtn: '确认解绑',
    cancelBtn: '取消',
    theme: 'warning',
    onConfirm: async () => {
      try {
        await adminApi.unbindUserSocialAccount(userId, provider)
        MessagePlugin.success('绑定已解除')
        await loadUsers()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '解绑失败') }
      dialog.hide()
    },
  })
}

async function unbindSocialPlaceholder(user: UserProfile) {
  const provider = user.registrationSource || ''
  const targetUserId = user.boundToUser?.id
  if (!provider || !targetUserId) return MessagePlugin.warning('未找到可解绑的第三方绑定')

  await unbindSocial(targetUserId, provider)
}

// ── Bind User (for social users) ──
async function openUserBind(user: UserProfile) {
  userBindTarget.value = user
  userBindUsername.value = ''
  bindableUsers.value = []
  selectedBindUser.value = null
  showUserBindDialog.value = true
}

async function searchBindableUsers() {
  if (!userBindUsername.value.trim()) {
    bindableUsers.value = []
    return
  }
  try {
    bindableUsers.value = await adminApi.searchUsers(userBindUsername.value.trim())
  } catch (e: unknown) {
    MessagePlugin.error((e as { message?: string })?.message || '搜索用户失败')
  }
}

async function bindToUser() {
  const target = selectedBindUser.value?.id || userBindUsername.value.trim()
  if (!target) return MessagePlugin.warning('请选择或输入目标用户')
  if (!userBindTarget.value) return
  saving.value = true
  try {
    await adminApi.transferSocialBindings(userBindTarget.value.id, target)
    MessagePlugin.success('已成功绑定用户')
    showUserBindDialog.value = false
    await loadUsers()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '绑定失败') }
  finally { saving.value = false }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="用户管理"
    >
      <template #actions>
        <NButton @click="loadUsers">刷新</NButton>
        <NButton type="primary" @click="openCreate">新建用户</NButton>
      </template>
    </PageHeader>

    <div class="metric-grid">
      <MetricCard label="用户总数" :value="String(users.length)" caption="含本地账号与第三方创建账号" :trend="`${users.length}`" tone="info" />
      <MetricCard label="管理员" :value="String(adminCount)" caption="拥有控制台权限的账号" trend="角色受控" tone="warning" />
      <MetricCard label="已验证邮箱" :value="String(verifiedCount)" caption="邮箱已完成验证" :trend="users.length ? Math.round(verifiedCount / users.length * 100) + '%' : '0%'" tone="success" />
      <MetricCard label="已禁用" :value="String(disabledCount)" caption="因风控或离职被禁用" trend="需复核" tone="danger" />
    </div>

    <section class="panel-card p-6">
      <div class="grid gap-4 lg:grid-cols-[1.5fr,0.8fr,0.8fr,auto]">
        <NInput v-model:value="searchQuery" size="large" placeholder="搜索邮箱 / 用户名" />
        <NSelect v-model:value="roleFilter" size="large" :options="roleOptions" />
        <NSelect v-model:value="statusFilter" size="large" :options="statusOptions" />
        <NButton class="!h-11 !px-5" @click="loadUsers">筛选</NButton>
      </div>

      <div class="mt-5">
        <div class="table-shell">
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>角色</th>
                  <th>类型</th>
                  <th>绑定状态</th>
                  <th>邮箱验证</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in filteredUsers" :key="item.id">
                  <td>
                    <p class="font-semibold text-[var(--text-primary)]">{{ item.username || '未设置用户名' }}</p>
                    <p class="mt-1 text-sm text-[var(--text-muted)]">{{ item.email }}</p>
                  </td>
                  <td>
                    <StatusTag :tone="item.role === 'admin' ? 'warning' : 'neutral'" :label="item.role === 'admin' ? '管理员' : '用户'" />
                  </td>
                  <td>
                    <StatusTag :tone="isSocialUser(item) ? 'info' : 'neutral'" :label="isSocialUser(item) ? '第三方注册' : '本地注册'" />
                  </td>
                  <td>
                    <!-- Regular user → show bound social accounts -->
                    <template v-if="isRegularUser(item)">
                      <div v-if="item.socialAccounts && item.socialAccounts.length > 0" class="flex flex-wrap gap-1">
                        <span
                          v-for="sa in item.socialAccounts"
                          :key="sa.provider"
                          class="token-chip text-xs cursor-pointer hover:opacity-80"
                          :title="`点击解绑 ${sa.provider} ${sa.providerUserId}`"
                          @click="unbindSocial(item.id, sa.provider)"
                        >{{ sa.provider }} {{ sa.providerUserId }} ✕</span>
                      </div>
                      <span v-else class="text-sm text-[var(--text-muted)]">未绑定三方</span>
                    </template>
                    <!-- Social user → show if bound to a regular user -->
                    <template v-else>
                      <div v-if="item.boundToUser" class="flex items-center gap-2">
                        <StatusTag tone="success" label="已绑定用户" />
                        <span class="text-xs text-[var(--text-primary)]">{{ item.boundToUser.username || item.boundToUser.email }}</span>
                        <button
                          class="token-chip text-xs cursor-pointer hover:opacity-80"
                          type="button"
                          @click="unbindSocialPlaceholder(item)"
                        >解除绑定</button>
                      </div>
                      <span v-else class="text-sm text-[var(--text-muted)]">未绑定用户</span>
                    </template>
                  </td>
                  <td>
                    <StatusTag :tone="item.emailVerified ? 'success' : 'warning'" :label="item.emailVerified ? '已验证' : '未验证'" />
                  </td>
                  <td>
                    <StatusTag :tone="item.status === 'active' ? 'success' : 'danger'" :label="item.status === 'active' ? '启用' : '禁用'" />
                  </td>
                  <td>
                    <div class="flex gap-1.5 flex-wrap">
                      <NButton size="small" class="action-tag action-edit" @click="openEdit(item)">编辑</NButton>
                      <NButton
                        size="small"
                        :class="['action-tag', item.status === 'active' ? 'action-disable' : 'action-enable']"
                        :disabled="isAdminUser(item)"
                        @click="toggleStatus(item)"
                      >{{ item.status === 'active' ? '禁用' : '启用' }}</NButton>
                      <NButton size="small" class="action-tag action-reset" @click="openPasswordReset(item.id)">重置密码</NButton>
                      <NButton
                        v-if="isRegularUser(item)"
                        size="small"
                        class="action-tag action-bind"
                        @click="openSocialBind(item)"
                      >绑定三方</NButton>
                      <NButton
                        v-if="isSocialUser(item) && !item.boundToUser"
                        size="small"
                        class="action-tag action-bind"
                        @click="openUserBind(item)"
                      >绑定用户</NButton>
                      <NButton
                        size="small"
                        class="action-tag action-delete"
                        :disabled="hasDeleteBlocker(item)"
                        :title="deleteBlockerText(item)"
                        @click="deleteUser(item)"
                      >删除</NButton>
                    </div>
                  </td>
                </tr>
                <tr v-if="filteredUsers.length === 0 && !loading">
                  <td colspan="7" class="text-center py-8 text-[var(--text-muted)]">暂无用户数据</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- Create/Edit User Dialog -->
    <NModal
      v-model:show="showUserDialog"
      preset="card"
      :title="editingUser ? '编辑用户' : '新建用户'"
      style="width: 520px"
    >
      <form class="space-y-4 pt-2" @submit.prevent="saveUser">
        <NInput v-model:value="userForm.email" size="large" placeholder="邮箱" :disabled="!!editingUser" />
        <NInput v-model:value="userForm.username" size="large" placeholder="用户名" />
        <NInput v-if="!editingUser" v-model:value="userForm.password" type="password" size="large" placeholder="密码" />
        <NSelect
          v-model:value="userForm.status"
          size="large"
          :disabled="editingUser?.role === 'admin'"
          :options="userStatusOptions"
        />
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showUserDialog = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="saveUser">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- Reset Password Dialog -->
    <NModal
      v-model:show="showPasswordDialog"
      preset="card"
      title="重置密码"
      style="width: 400px"
    >
      <form class="pt-2" @submit.prevent="resetPassword(newPassword)">
        <NInput v-model:value="newPassword" size="large" type="password" placeholder="输入新密码" />
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showPasswordDialog = false">取消</NButton>
          <NButton type="warning" :loading="saving" @click="resetPassword(newPassword)">确认重置</NButton>
        </div>
      </template>
    </NModal>

    <!-- Social Bind Dialog -->
    <NModal
      v-model:show="showSocialDialog"
      preset="card"
      title="绑定第三方账号"
      style="width: 580px"
      @close="resetSocialBindDialog"
    >
      <div class="space-y-4 pt-2">
        <p class="text-sm text-[var(--text-secondary)]">
          为用户 <span class="font-semibold text-[var(--text-primary)]">{{ bindTargetUser?.username || bindTargetUser?.email }}</span> 绑定第三方账号
        </p>

        <!-- Mode switch -->
        <div class="flex gap-2 rounded-2xl bg-[var(--surface-secondary)] p-1">
          <button
            :class="['flex-1 rounded-xl px-4 py-2 text-sm font-medium', socialBindMode === 'input' ? 'bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]']"
            @click="switchSocialBindMode('input')"
          >输入三方 ID</button>
          <button
            :class="['flex-1 rounded-xl px-4 py-2 text-sm font-medium', socialBindMode === 'qrcode' ? 'bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]']"
            @click="switchSocialBindMode('qrcode')"
          >扫码绑定</button>
        </div>

        <!-- Input mode -->
        <template v-if="socialBindMode === 'input'">
          <NInput v-model:value="socialSearch" size="large" placeholder="搜索第三方用户 ID（如 wechat_xxx）" />

          <div v-if="socialSearch && filteredSocialAccounts.length" class="space-y-2 max-h-48 overflow-y-auto">
            <div
              v-for="sa in filteredSocialAccounts"
              :key="sa.id"
              :class="['rounded-2xl border px-4 py-3 cursor-pointer', selectedSocial?.id === sa.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-primary)] bg-[var(--surface-primary)] hover:border-[var(--border-strong)]']"
              @click="selectedSocial = sa"
            >
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-[var(--text-primary)]">{{ sa.provider }}</p>
                  <p class="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{{ sa.providerUserId }}</p>
                </div>
                <StatusTag v-if="selectedSocial?.id === sa.id" tone="success" label="已选择" />
                <StatusTag v-else tone="neutral" label="未绑定" />
              </div>
            </div>
          </div>

          <div v-else-if="socialSearch && !filteredSocialAccounts.length" class="panel-muted p-4 text-center">
            <p class="text-sm text-[var(--text-muted)]">未找到匹配的未绑定第三方账号</p>
          </div>

          <div v-else-if="!socialSearch" class="panel-muted p-4 text-center">
            <p class="text-sm text-[var(--text-muted)]">输入第三方用户 ID 搜索可绑定的账号</p>
          </div>

          <div v-if="selectedSocial" class="rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3">
            <p class="text-sm text-[var(--text-primary)]">将绑定：<span class="font-semibold">{{ selectedSocial.provider }} {{ selectedSocial.providerUserId }}</span></p>
          </div>
        </template>

        <!-- QR Code mode -->
        <template v-if="socialBindMode === 'qrcode'">
          <div v-if="enabledProviders.length === 0" class="panel-muted p-4 text-center">
            <p class="text-sm text-[var(--text-muted)]">暂无已开启的第三方平台，请先在系统设置中启用</p>
          </div>

          <div v-else class="space-y-4">
            <p class="text-sm text-[var(--text-muted)]">选择一个已开启的第三方平台，生成授权二维码</p>
            <div class="grid grid-cols-2 gap-3">
              <div
                v-for="p in enabledProviders"
                :key="p.name"
                :class="['rounded-2xl border px-4 py-3 cursor-pointer', selectedQrProvider?.name === p.name ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-primary)] bg-[var(--surface-primary)] hover:border-[var(--border-strong)]']"
                @click="selectQrProvider(p)"
              >
                <p class="text-sm font-semibold text-[var(--text-primary)]">{{ p.name }}</p>
                <p class="mt-0.5 text-xs text-[var(--text-muted)]">{{ p.type }}</p>
              </div>
            </div>

            <div v-if="selectedQrProvider" class="flex flex-col items-center gap-3 rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] p-6">
              <p class="text-sm font-semibold text-[var(--text-primary)]">{{ selectedQrProvider.name }} 授权二维码</p>
              <p class="text-xs text-[var(--text-muted)]">
                {{ socialBindMessage || (socialBindPolling ? '等待扫码/授权' : '用户使用手机扫码完成第三方授权绑定') }}
              </p>
              <div class="relative grid min-h-[220px] w-[220px] place-items-center rounded-2xl bg-white p-2">
                <img v-if="socialBindDisplayUrl" :src="socialBindDisplayUrl" alt="第三方授权二维码" class="h-[220px] w-[220px] rounded-xl object-contain" @error="handleSocialBindQrImageError" />
                <div v-else class="grid h-[220px] w-[220px] place-items-center rounded-xl bg-slate-50 text-sm text-slate-500">二维码生成中...</div>
                <div
                  v-if="socialBindStatus === 'success' || socialBindStatus === 'failed' || socialBindStatus === 'expired'"
                  class="absolute inset-2 grid place-items-center rounded-xl bg-white/92 backdrop-blur-sm"
                >
                  <div class="space-y-2 text-center">
                    <div
                      :class="[
                        'mx-auto grid h-14 w-14 place-items-center rounded-2xl text-2xl font-bold text-white',
                        socialBindStatus === 'success' ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'
                      ]"
                    >
                      {{ socialBindStatus === 'success' ? '✓' : '!' }}
                    </div>
                    <p class="text-sm font-semibold text-slate-900">{{ socialBindStatus === 'success' ? '授权成功' : socialBindStatus === 'expired' ? '二维码过期' : '授权失败' }}</p>
                  </div>
                </div>
              </div>
              <p v-if="socialBindUrl" class="break-all text-center font-mono text-xs text-[var(--text-muted)] max-w-xs">{{ socialBindUrl }}</p>
              <p v-else class="text-sm text-[var(--text-muted)]">生成中...</p>
            </div>
          </div>
        </template>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showSocialDialog = false">关闭</NButton>
          <NButton v-if="socialBindMode === 'input'" type="primary" :loading="saving" :disabled="!selectedSocial" @click="bindSocial">绑定</NButton>
        </div>
      </template>
    </NModal>

    <!-- Bind User Dialog (for social users) -->
    <NModal
      v-model:show="showUserBindDialog"
      preset="card"
      title="绑定用户账号"
      style="width: 440px"
    >
      <div class="space-y-4 pt-2">
        <p class="text-sm text-[var(--text-secondary)]">
          为三方账号 <span class="font-semibold text-[var(--text-primary)]">{{ userBindTarget?.username || userBindTarget?.email }}</span> 绑定已有用户
        </p>
        <p class="text-xs text-[var(--text-muted)]">输入用户名、邮箱或用户 ID 后自动搜索，选择目标用户完成绑定。</p>
        <NInput
          v-model:value="userBindUsername"
          size="large"
          placeholder="搜索用户名 / 邮箱 / 用户 ID"
        />
        <div v-if="userBindUsername.trim()" class="max-h-56 space-y-2 overflow-y-auto">
          <div
            v-for="candidate in bindableUsers"
            :key="candidate.id"
            :class="['rounded-2xl border px-4 py-3 cursor-pointer', selectedBindUser?.id === candidate.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-primary)] bg-[var(--surface-primary)] hover:border-[var(--border-strong)]']"
            @click="selectedBindUser = candidate"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-[var(--text-primary)]">{{ candidate.username || '未设置用户名' }}</p>
                <p class="truncate text-xs text-[var(--text-muted)]">{{ candidate.email || candidate.id }}</p>
              </div>
              <StatusTag :tone="selectedBindUser?.id === candidate.id ? 'success' : 'neutral'" :label="selectedBindUser?.id === candidate.id ? '已选择' : '可绑定'" />
            </div>
          </div>
          <div v-if="bindableUsers.length === 0" class="panel-muted p-4 text-center">
            <p class="text-sm text-[var(--text-muted)]">未找到匹配用户</p>
          </div>
        </div>
        <div v-else class="panel-muted p-4 text-center">
          <p class="text-sm text-[var(--text-muted)]">输入关键字后显示可绑定用户</p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showUserBindDialog = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="bindToUser">确认绑定</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
