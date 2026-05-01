<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { adminApi } from '../../api/admin'
import type { UserProfile, SocialAccountItem } from '../../types/api'
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
  role: 'user' as 'admin' | 'user',
  status: 'active' as 'active' | 'disabled',
})

const socialSearch = ref('')
const selectedSocial = ref<SocialAccountItem | null>(null)

const adminCount = computed(() => users.value.filter(u => u.role === 'admin').length)
const verifiedCount = computed(() => users.value.filter(u => u.emailVerified).length)
const disabledCount = computed(() => users.value.filter(u => u.status === 'disabled').length)

const filteredUsers = computed(() => {
  let result = users.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(u =>
      (u.email?.toLowerCase().includes(q)) ||
      (u.username?.toLowerCase().includes(q))
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

function isSocialUser(user: UserProfile) {
  if (user.socialAccounts && user.socialAccounts.length > 0) return true
  if (user.email?.includes('@social.local')) return true
  if (user.registrationSource?.toLowerCase().includes('social')) return true
  if (user.registrationSource?.toLowerCase().includes('第三方')) return true
  return false
}

function isRegularUser(user: UserProfile) {
  return !isSocialUser(user)
}

const filteredSocialAccounts = computed(() => {
  if (!socialSearch.value) return []
  const q = socialSearch.value.toLowerCase()
  return allSocialAccounts.value.filter(sa => {
    if (sa.userId) return false
    return sa.provider.toLowerCase().includes(q) ||
           sa.providerUserId.toLowerCase().includes(q)
  })
})

onMounted(async () => {
  await loadUsers()
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
  userForm.role = 'user'
  userForm.status = 'active'
  showUserDialog.value = true
}

function openEdit(user: UserProfile) {
  editingUser.value = user
  userForm.email = user.email || ''
  userForm.username = user.username || ''
  userForm.password = ''
  userForm.role = user.role
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
        role: userForm.role,
        status: userForm.status,
      })
      MessagePlugin.success('用户已更新')
    } else {
      if (!userForm.password) return MessagePlugin.warning('请输入密码')
      await adminApi.createUser({
        email: userForm.email,
        username: userForm.username || undefined,
        password: userForm.password,
        role: userForm.role,
      })
      MessagePlugin.success('用户已创建')
    }
    showUserDialog.value = false
    await loadUsers()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
}

async function deleteUser(user: UserProfile) {
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

  if (isSocialUser(user)) {
    MessagePlugin.warning('第三方注册用户无法绑定其他第三方账号')
    return
  }

  try {
    allSocialAccounts.value = await adminApi.listAllSocialAccounts()
  } catch { /* silent */ }
  showSocialDialog.value = true
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
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      eyebrow="管理员视角"
      title="用户管理"
      description="管理用户生命周期、角色、状态和第三方绑定关系。普通用户可绑定第三方账号，第三方用户可绑定已有普通用户，禁止同类型互绑。"
    >
      <template #actions>
        <t-button variant="outline" @click="loadUsers">刷新</t-button>
        <t-button theme="primary" @click="openCreate">新建用户</t-button>
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
        <t-input v-model="searchQuery" size="large" placeholder="搜索邮箱 / 用户名" />
        <t-select v-model="roleFilter" size="large" :options="roleOptions" />
        <t-select v-model="statusFilter" size="large" :options="statusOptions" />
        <t-button variant="outline" class="!h-11 !px-5" @click="loadUsers">筛选</t-button>
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
                      <t-button variant="outline" size="small" @click="openEdit(item)">编辑</t-button>
                      <t-button variant="outline" size="small" :theme="item.status === 'active' ? 'warning' : 'success'" @click="toggleStatus(item)">{{ item.status === 'active' ? '禁用' : '启用' }}</t-button>
                      <t-button variant="outline" size="small" @click="openPasswordReset(item.id)">重置密码</t-button>
                      <t-button
                        v-if="isRegularUser(item)"
                        variant="outline"
                        size="small"
                        @click="openSocialBind(item)"
                      >绑定三方</t-button>
                      <t-button variant="outline" size="small" theme="danger" @click="deleteUser(item)">删除</t-button>
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
    <t-dialog
      v-model:visible="showUserDialog"
      :header="editingUser ? '编辑用户' : '新建用户'"
      width="520px"
      :confirm-btn="{ content: '保存', theme: 'primary', loading: saving }"
      :cancel-btn="{ content: '取消', variant: 'outline' }"
      @confirm="saveUser"
    >
      <div class="space-y-4 pt-2">
        <t-input v-model="userForm.email" size="large" placeholder="邮箱" :disabled="!!editingUser" />
        <t-input v-model="userForm.username" size="large" placeholder="用户名" />
        <t-input v-if="!editingUser" v-model="userForm.password" type="password" size="large" placeholder="密码" />
        <div class="grid gap-4 sm:grid-cols-2">
          <t-select
            v-model="userForm.role"
            size="large"
            :options="[
              { label: '管理员', value: 'admin' },
              { label: '用户', value: 'user' },
            ]"
          />
          <t-select
            v-model="userForm.status"
            size="large"
            :options="[
              { label: '启用', value: 'active' },
              { label: '禁用', value: 'disabled' },
            ]"
          />
        </div>
      </div>
    </t-dialog>

    <!-- Reset Password Dialog -->
    <t-dialog
      v-model:visible="showPasswordDialog"
      header="重置密码"
      width="400px"
      :confirm-btn="{ content: '确认重置', theme: 'warning', loading: saving }"
      :cancel-btn="{ content: '取消', variant: 'outline' }"
      @confirm="resetPassword(newPassword)"
    >
      <div class="pt-2">
        <t-input v-model="newPassword" size="large" type="password" placeholder="输入新密码" />
      </div>
    </t-dialog>

    <!-- Social Bind Dialog -->
    <t-dialog
      v-model:visible="showSocialDialog"
      header="绑定第三方账号"
      width="540px"
      :confirm-btn="{ content: '绑定', theme: 'primary', loading: saving, disabled: !selectedSocial }"
      :cancel-btn="{ content: '取消', variant: 'outline' }"
      @confirm="bindSocial"
      @close="socialSearch = ''; selectedSocial = null"
    >
      <div class="space-y-4 pt-2">
        <p class="text-sm text-[var(--text-secondary)]">
          为用户 <span class="font-semibold text-[var(--text-primary)]">{{ bindTargetUser?.username || bindTargetUser?.email }}</span> 绑定第三方账号
        </p>
        <t-input v-model="socialSearch" size="large" placeholder="搜索第三方用户 ID（如 wechat_xxx）" />

        <div v-if="socialSearch && filteredSocialAccounts.length" class="space-y-2 max-h-48 overflow-y-auto">
          <div
            v-for="sa in filteredSocialAccounts"
            :key="sa.id"
            :class="['rounded-2xl border px-4 py-3 cursor-pointer transition-all', selectedSocial?.id === sa.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-primary)] bg-[var(--surface-primary)] hover:border-[var(--border-strong)]']"
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
      </div>
    </t-dialog>
  </div>
</template>
