<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { adminApi } from '../../api/admin'
import type { ApplicationItem, ApplicationCreateResponse, SocialProviderConfig } from '../../types/api'
import MetricCard from '../../components/MetricCard.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'

const loading = ref(false)
const saving = ref(false)
const apps = ref<ApplicationItem[]>([])
const searchQuery = ref('')
const statusFilter = ref<'全部' | 'active' | 'disabled'>('全部')

const showCreateDialog = ref(false)
const showSecretDialog = ref(false)
const editingApp = ref<ApplicationItem | null>(null)
const secretResult = ref<ApplicationCreateResponse | null>(null)
const enabledProviders = ref<SocialProviderConfig[]>([])

const formData = reactive({
  name: '',
  description: '',
  redirectUris: '',
  scopes: '',
  allowRegistration: false,
  enabledSocialProviders: [] as string[],
})

const providerLabel = (name: string) => {
  const map: Record<string, string> = {
    wechat: '微信', qq: 'QQ', github: 'GitHub', google: 'Google',
    alipay: '支付宝', weibo: '微博', baidu: '百度',
    huawei: '华为', xiaomi: '小米', douyin: '抖音',
    bilibili: 'B站', dingtalk: '钉钉',
  }
  return map[name] ?? name
}

const providerOptions = computed(() =>
  enabledProviders.value
    .filter(p => p.enabled)
    .map(p => ({ label: providerLabel(p.name), value: p.name }))
)

const statusOptions = [
  { label: '全部状态', value: '全部' },
  { label: '启用', value: 'active' },
  { label: '禁用', value: 'disabled' },
]

const filteredApps = computed(() => {
  let result = apps.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.clientId.toLowerCase().includes(q)
    )
  }
  if (statusFilter.value !== '全部') {
    result = result.filter(a => a.status === statusFilter.value)
  }
  return result
})

const onlineCount = computed(() => apps.value.filter(a => a.status === 'active').length)
const registrationCount = computed(() => apps.value.filter(a => a.allowRegistration).length)
const allScopes = computed(() => [...new Set(apps.value.flatMap(a => a.scopes))])

onMounted(async () => {
  await Promise.all([loadApps(), loadProviders()])
})

async function loadProviders() {
  try { enabledProviders.value = await adminApi.listSocialProviders() } catch { /* silent */ }
}

async function loadApps() {
  loading.value = true
  try {
    apps.value = await adminApi.listApplications()
  } catch { /* silent */ }
  finally { loading.value = false }
}

function openCreate() {
  editingApp.value = null
  formData.name = ''
  formData.description = ''
  formData.redirectUris = ''
  formData.scopes = ''
  formData.allowRegistration = false
  formData.enabledSocialProviders = []
  showCreateDialog.value = true
}

function openEdit(app: ApplicationItem) {
  editingApp.value = app
  formData.name = app.name
  formData.description = app.description || ''
  formData.redirectUris = app.redirectUris.join('\n')
  formData.scopes = app.scopes.join('\n')
  formData.allowRegistration = app.allowRegistration
  formData.enabledSocialProviders = [...app.enabledSocialProviders]
  showCreateDialog.value = true
}

async function saveApp() {
  if (!formData.name) return MessagePlugin.warning('请输入应用名称')
  if (!formData.redirectUris.trim()) return MessagePlugin.warning('请输入至少一个回调地址')

  const payload = {
    name: formData.name,
    description: formData.description || undefined,
    redirectUris: formData.redirectUris.split('\n').map(s => s.trim()).filter(Boolean),
    scopes: formData.scopes.split('\n').map(s => s.trim()).filter(Boolean),
    allowRegistration: formData.allowRegistration,
    enabledSocialProviders: formData.enabledSocialProviders,
  }

  saving.value = true
  try {
    if (editingApp.value) {
      const { clientSecret: _, ...updatePayload } = payload as typeof payload & { clientSecret?: string }
      await adminApi.updateApplication(editingApp.value.id, updatePayload)
      MessagePlugin.success('应用已更新')
    } else {
      const result = await adminApi.createApplication(payload)
      secretResult.value = result
      showSecretDialog.value = true
    }
    showCreateDialog.value = false
    await loadApps()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
}

async function deleteApp(app: ApplicationItem) {
  const dialog = DialogPlugin.confirm({
    header: '删除应用',
    body: `确定要删除 "${app.name}" 吗？该操作不可撤销，所有关联的授权记录将失效。`,
    confirmBtn: '确认删除',
    cancelBtn: '取消',
    theme: 'danger',
    onConfirm: async () => {
      try {
        await adminApi.deleteApplication(app.id)
        MessagePlugin.success('应用已删除')
        await loadApps()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '删除失败') }
      dialog.hide()
    },
  })
}

async function toggleStatus(app: ApplicationItem) {
  const newStatus = app.status === 'active' ? 'disabled' : 'active'
  try {
    await adminApi.updateApplicationStatus(app.id, newStatus)
    MessagePlugin.success(newStatus === 'active' ? '应用已启用' : '应用已禁用')
    await loadApps()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '操作失败') }
}

async function resetSecret(app: ApplicationItem) {
  const dialog = DialogPlugin.confirm({
    header: '重置密钥',
    body: `确定要重置 "${app.name}" 的 Client Secret 吗？旧密钥将立即失效，新密钥仅在本次展示。`,
    confirmBtn: '确认重置',
    cancelBtn: '取消',
    theme: 'warning',
    onConfirm: async () => {
      try {
        const result = await adminApi.resetSecret(app.id)
        secretResult.value = { ...app, clientSecret: result.clientSecret, id: app.id, name: app.name, description: app.description, redirectUris: app.redirectUris, scopes: app.scopes, allowRegistration: app.allowRegistration, enabledSocialProviders: app.enabledSocialProviders, status: app.status, createdAt: app.createdAt, updatedAt: app.updatedAt }
        showSecretDialog.value = true
        MessagePlugin.success('密钥已重置')
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '重置失败') }
      dialog.hide()
    },
  })
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => {
    MessagePlugin.success(`${label} 已复制`)
  })
}

async function viewSecret(app: ApplicationItem) {
  try {
    const result = await adminApi.getSecret(app.id)
    if (!result.clientSecret) {
      MessagePlugin.warning('该应用未存储密钥，需重置后才能查看')
      return
    }
    secretResult.value = { ...app, clientSecret: result.clientSecret }
    showSecretDialog.value = true
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '获取密钥失败') }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="应用接入"
    >
      <template #actions>
        <t-button variant="outline" @click="loadApps">刷新</t-button>
        <t-button theme="primary" @click="openCreate">新建应用</t-button>
      </template>
    </PageHeader>

    <div class="metric-grid">
      <MetricCard label="应用总数" :value="String(apps.length)" caption="支持 OAuth2 / OIDC 的业务系统" :trend="`+${apps.length}`" tone="info" />
      <MetricCard label="在线应用" :value="String(onlineCount)" caption="当前状态为启用的应用" :trend="apps.length ? Math.round(onlineCount / apps.length * 100) + '%' : '0%'" tone="success" />
      <MetricCard label="开放注册" :value="String(registrationCount)" caption="允许从授权流程中注册新用户" trend="场景受控" tone="warning" />
      <MetricCard label="共享 Scope" :value="String(allScopes.length)" caption="跨应用使用的 Scope 种类" trend="需统一治理" tone="neutral" />
    </div>

    <section class="panel-card p-6">
      <div class="grid gap-4 lg:grid-cols-[1.2fr,1fr,auto]">
        <t-input v-model="searchQuery" size="large" placeholder="搜索应用名称 / Client ID" @keyup.enter="loadApps" />
        <t-select v-model="statusFilter" size="large" :options="statusOptions" />
        <t-button variant="outline" class="!h-11 !px-5" @click="loadApps">筛选</t-button>
      </div>

      <div class="mt-5 grid gap-6 xl:grid-cols-[1.55fr,0.85fr]">
        <div class="table-shell">
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>应用</th>
                  <th>Client ID</th>
                  <th>回调地址</th>
                  <th>状态</th>
                  <th>注册</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in filteredApps" :key="item.id">
                  <td>
                    <p class="font-semibold text-[var(--text-primary)]">{{ item.name }}</p>
                    <p v-if="item.description" class="mt-1 text-sm text-[var(--text-muted)]">{{ item.description }}</p>
                    <p v-if="item.owner" class="mt-1 text-xs text-[var(--text-muted)]">提交人：{{ item.owner.username || item.owner.email }}</p>
                    <p v-if="item.status === 'disabled'" class="mt-1 text-xs font-semibold text-[var(--danger)]">已禁用 — 授权流程已暂停</p>
                  </td>
                  <td class="font-mono text-xs">{{ item.clientId }}</td>
                  <td class="font-mono text-xs">{{ item.redirectUris[0] || '—' }}</td>
                  <td>
                    <StatusTag :tone="item.status === 'active' ? 'success' : 'danger'" :label="item.status === 'active' ? '启用' : '禁用'" />
                  </td>
                  <td>
                    <StatusTag :tone="item.allowRegistration ? 'info' : 'neutral'" :label="item.allowRegistration ? '允许注册' : '仅登录'" />
                  </td>
                  <td>
                    <div class="flex gap-1.5 flex-wrap">
                      <t-button variant="outline" size="small" @click="openEdit(item)">编辑</t-button>
                      <t-button variant="outline" size="small" :theme="item.status === 'active' ? 'warning' : 'success'" @click="toggleStatus(item)">{{ item.status === 'active' ? '禁用' : '启用' }}</t-button>
                      <t-button variant="outline" size="small" @click="viewSecret(item)">查看密钥</t-button>
                      <t-button variant="outline" size="small" @click="resetSecret(item)">重置密钥</t-button>
                      <t-button variant="outline" size="small" theme="danger" @click="deleteApp(item)">删除</t-button>
                    </div>
                  </td>
                </tr>
                <tr v-if="filteredApps.length === 0 && !loading">
                  <td colspan="6" class="text-center py-8 text-[var(--text-muted)]">暂无应用数据</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="space-y-5">
          <div class="panel-muted p-5">
            <p class="eyebrow">快速操作</p>
            <div class="mt-4 space-y-3">
              <t-button block theme="primary" @click="openCreate">新建应用</t-button>
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <span v-for="scope in allScopes.slice(0, 8)" :key="scope" class="token-chip font-mono">{{ scope }}</span>
            </div>
          </div>

          <div class="panel-muted p-5">
            <p class="eyebrow">凭据安全</p>
            <div class="mt-4 space-y-3">
              <div class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4">
                <p class="text-sm font-semibold text-[var(--text-primary)]">Client Secret 一次性展示</p>
                <p class="mt-1 text-sm leading-6 text-[var(--text-muted)]">创建或重置密钥后立即复制保存，关闭弹窗后无法再次查看。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Create/Edit Dialog -->
    <t-dialog
      v-model:visible="showCreateDialog"
      :header="editingApp ? '编辑应用' : '新建应用'"
      width="620px"
      :confirm-btn="{ content: editingApp ? '保存' : '创建', theme: 'primary', loading: saving }"
      :cancel-btn="{ content: '取消', variant: 'outline' }"
      @confirm="saveApp"
    >
      <div class="space-y-4 pt-2">
        <div v-if="editingApp?.status === 'disabled'" class="rounded-2xl border border-[rgba(220,38,38,0.15)] bg-[rgba(239,68,68,0.08)] p-4">
          <p class="text-sm font-semibold text-[var(--danger)]">该应用已禁用</p>
          <p class="mt-1 text-sm text-[var(--text-muted)]">禁用期间所有 OAuth 授权流程将被拒绝，用户无法通过此应用登录。</p>
        </div>
        <t-input v-model="formData.name" size="large" placeholder="应用名称" />
        <t-input v-model="formData.description" size="large" placeholder="描述（可选）" />
        <t-textarea
          v-model="formData.redirectUris"
          placeholder="回调地址（每行一个）"
          :autosize="{ minRows: 2, maxRows: 4 }"
        />
        <t-textarea
          v-model="formData.scopes"
          placeholder="Scope（每行一个，默认 openid profile email）"
          :autosize="{ minRows: 2, maxRows: 4 }"
        />
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-[var(--text-primary)]">允许注册</span>
          <t-switch v-model="formData.allowRegistration" />
        </div>
        <t-select
          v-model="formData.enabledSocialProviders"
          :options="providerOptions"
          placeholder="选择已启用的第三方登录"
          multiple
          size="large"
          :min-collapsed-num="3"
        />
      </div>
    </t-dialog>

    <!-- Secret Display Dialog -->
    <t-dialog
      v-model:visible="showSecretDialog"
      header="凭据信息"
      width="560px"
      :footer="false"
    >
      <div class="space-y-4">
        <div class="rounded-2xl border border-[rgba(220,38,38,0.15)] bg-[rgba(239,68,68,0.08)] p-4">
          <p class="text-sm font-semibold text-[var(--danger)]">请立即复制保存</p>
          <p class="mt-1 text-sm text-[var(--text-muted)]">关闭此弹窗后 Client Secret 将无法再次查看。</p>
        </div>
        <div v-if="secretResult" class="space-y-3">
          <div class="code-pill justify-between cursor-pointer" @click="copyToClipboard(secretResult.clientId, 'Client ID')">
            <span>Client ID</span>
            <span class="font-mono">{{ secretResult.clientId }}</span>
          </div>
          <div class="code-pill justify-between cursor-pointer" @click="copyToClipboard(secretResult.clientSecret, 'Client Secret')">
            <span>Client Secret</span>
            <span class="font-mono">{{ secretResult.clientSecret }}</span>
          </div>
        </div>
        <div class="action-row">
          <t-button variant="outline" @click="copyToClipboard(secretResult!.clientId, 'Client ID')">复制 ID</t-button>
          <t-button theme="primary" @click="copyToClipboard(secretResult!.clientSecret, 'Client Secret')">复制 Secret</t-button>
        </div>
      </div>
    </t-dialog>
  </div>
</template>
