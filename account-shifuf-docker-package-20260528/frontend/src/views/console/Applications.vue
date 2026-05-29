<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { NButton, NInput, NSelect, NModal, NSwitch } from 'naive-ui'
import { MessagePlugin, DialogPlugin } from '../../utils/ui'
import { adminApi } from '../../api/admin'
import type { ApplicationItem, ApplicationCreateResponse, SocialProviderConfig } from '../../types/api'
import MetricCard from '../../components/MetricCard.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'
import Icon from '../../components/Icon.vue'

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

const iconColors = ['var(--accent)', 'var(--warning)', 'var(--success)', '#6366f1', 'var(--danger)', '#8b5cf6']
const iconNames = ['app', 'cloud', 'shop', 'internet', 'server', 'computer']
function appIconColor(index: number) { return iconColors[index % iconColors.length] }
function appIconName(index: number) { return iconNames[index % iconNames.length] }
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="应用接入"
    >
      <template #actions>
        <NButton class="lumina-outline-btn" @click="loadApps">刷新</NButton>
        <NButton type="primary" class="lumina-primary-btn" @click="openCreate">新建应用</NButton>
      </template>
    </PageHeader>

    <div class="metric-grid">
      <MetricCard label="应用总数" :value="String(apps.length)" caption="支持 OAuth2 / OIDC 的业务系统" :trend="`+${apps.length}`" tone="info" />
      <MetricCard label="在线应用" :value="String(onlineCount)" caption="当前状态为启用的应用" :trend="apps.length ? Math.round(onlineCount / apps.length * 100) + '%' : '0%'" tone="success" />
      <MetricCard label="开放注册" :value="String(registrationCount)" caption="允许从授权流程中注册新用户" trend="场景受控" tone="warning" />
      <MetricCard label="共享 Scope" :value="String(allScopes.length)" caption="跨应用使用的 Scope 种类" trend="需统一治理" tone="neutral" />
    </div>

    <!-- Search & Filter bar -->
    <section class="panel-card p-6" style="border-radius: 2rem;">
      <div class="grid gap-4 lg:grid-cols-[1.2fr,1fr,auto]">
        <NInput v-model:value="searchQuery" size="large" placeholder="搜索应用名称 / Client ID" @keyup.enter="loadApps" />
        <NSelect v-model:value="statusFilter" size="large" :options="statusOptions" />
        <NButton class="!h-11 !px-5 lumina-outline-btn" @click="loadApps">筛选</NButton>
      </div>
    </section>

    <!-- App cards grid -->
    <div class="app-cards-grid">
      <div
        v-for="(item, index) in filteredApps"
        :key="item.id"
        class="app-card"
      >
        <div class="app-card-header">
          <div class="app-icon" :style="{ background: appIconColor(index) }">
            <Icon :name="appIconName(index)" size="22px" />
          </div>
          <div class="app-card-meta">
            <div class="flex items-center gap-2">
              <h3 class="app-card-name">{{ item.name }}</h3>
              <span v-if="item.status === 'active'" class="live-dot" title="在线"></span>
            </div>
            <p v-if="item.description" class="app-card-desc">{{ item.description }}</p>
          </div>
          <StatusTag :tone="item.status === 'active' ? 'success' : 'danger'" :label="item.status === 'active' ? '启用' : '禁用'" />
        </div>

        <!-- Client ID area -->
        <div class="app-client-id" @click="copyToClipboard(item.clientId, 'Client ID')">
          <span class="app-client-label">Client ID</span>
          <span class="app-client-value">{{ item.clientId }}</span>
          <Icon name="copy" size="14px" class="app-client-copy" />
        </div>

        <!-- Meta info -->
        <div class="app-card-info">
          <div class="app-info-item">
            <span class="app-info-label">回调地址</span>
            <span class="app-info-value font-mono">{{ item.redirectUris[0] || '—' }}</span>
          </div>
          <div class="app-info-item">
            <span class="app-info-label">注册策略</span>
            <StatusTag :tone="item.allowRegistration ? 'info' : 'neutral'" :label="item.allowRegistration ? '允许注册' : '仅登录'" />
          </div>
          <div v-if="item.owner" class="app-info-item">
            <span class="app-info-label">提交人</span>
            <span class="app-info-value">{{ item.owner.username || item.owner.email }}</span>
          </div>
        </div>

        <!-- Scope chips -->
        <div v-if="item.scopes.length > 0" class="app-scopes">
          <span v-for="scope in item.scopes.slice(0, 4)" :key="scope" class="scope-chip">{{ scope }}</span>
          <span v-if="item.scopes.length > 4" class="scope-chip scope-chip-more">+{{ item.scopes.length - 4 }}</span>
        </div>

        <!-- Actions -->
        <div class="app-card-actions">
          <NButton size="small" class="action-tag action-edit" @click="openEdit(item)">编辑</NButton>
          <NButton
            size="small"
            :class="['action-tag', item.status === 'active' ? 'action-disable' : 'action-enable']"
            @click="toggleStatus(item)"
          >{{ item.status === 'active' ? '禁用' : '启用' }}</NButton>
          <NButton size="small" class="action-tag action-secret" @click="viewSecret(item)">密钥</NButton>
          <NButton size="small" class="action-tag action-reset" @click="resetSecret(item)">重置</NButton>
          <NButton size="small" class="action-tag action-delete" @click="deleteApp(item)">删除</NButton>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="filteredApps.length === 0 && !loading" class="app-empty-state">
        <Icon name="app" size="40px" />
        <p class="mt-3 text-sm font-semibold text-[var(--text-primary)]">暂无应用数据</p>
        <p class="mt-1 text-xs text-[var(--text-muted)]">点击「新建应用」接入你的第一个 OAuth 业务系统</p>
        <NButton type="primary" class="lumina-primary-btn mt-4" @click="openCreate">新建应用</NButton>
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <NModal
      v-model:show="showCreateDialog"
      preset="card"
      :title="editingApp ? '编辑应用' : '新建应用'"
      style="width: 620px"
    >
      <div class="app-dialog-form">
        <div v-if="editingApp?.status === 'disabled'" class="app-dialog-alert app-dialog-alert--danger">
          <p class="text-sm font-semibold text-[var(--danger)]">该应用已禁用</p>
          <p class="mt-1 text-sm text-[var(--text-muted)]">禁用期间所有 OAuth 授权流程将被拒绝，用户无法通过此应用登录。</p>
        </div>

        <div class="app-dialog-grid">
          <label class="app-form-field">
            <span>应用名称</span>
              <NInput v-model:value="formData.name" size="large" placeholder="例如 一证通行业务系统" />
          </label>
          <label class="app-form-field">
            <span>应用描述</span>
            <NInput v-model:value="formData.description" size="large" placeholder="描述（可选）" />
          </label>
        </div>

        <label class="app-form-field">
          <span>回调地址</span>
          <NInput
            v-model:value="formData.redirectUris"
            type="textarea"
            placeholder="每行一个，例如 https://example.com/oauth/callback"
            :autosize="{ minRows: 3, maxRows: 5 }"
          />
        </label>

        <label class="app-form-field">
          <span>Scope 权限</span>
          <NInput
            v-model:value="formData.scopes"
            type="textarea"
            placeholder="每行一个，默认 openid / profile / email"
            :autosize="{ minRows: 3, maxRows: 5 }"
          />
        </label>

        <div class="app-dialog-option">
          <div>
            <p>允许注册</p>
            <span>允许用户从该应用 OAuth 授权链路创建账号</span>
          </div>
          <NSwitch v-model:value="formData.allowRegistration" />
        </div>

        <label class="app-form-field">
          <span>第三方登录</span>
          <NSelect
            v-model:value="formData.enabledSocialProviders"
            :options="providerOptions"
            placeholder="选择已启用的第三方登录"
            multiple
            size="large"
            :max-tag-count="3"
          />
        </label>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showCreateDialog = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="saveApp">{{ editingApp ? '保存' : '创建' }}</NButton>
        </div>
      </template>
    </NModal>

    <!-- Secret Display Dialog -->
    <NModal
      v-model:show="showSecretDialog"
      preset="card"
      title="凭据信息"
      style="width: 560px"
    >
      <div class="space-y-4">
        <div class="rounded-2xl border border-[rgba(244,63,94,0.15)] bg-[rgba(244,63,94,0.08)] p-4">
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
          <NButton class="lumina-outline-btn" @click="copyToClipboard(secretResult!.clientId, 'Client ID')">复制 ID</NButton>
          <NButton type="primary" class="lumina-primary-btn" @click="copyToClipboard(secretResult!.clientSecret, 'Client Secret')">复制 Secret</NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
/* App cards grid */
.app-cards-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 1023px) {
  .app-cards-grid { grid-template-columns: 1fr; }
}

/* Individual app card – Lumina style */
.app-card {
  background: var(--surface-primary);
  border: 1px solid var(--border-primary);
  border-radius: 1.5rem;
  padding: 20px;
  box-shadow: var(--shadow-card);
}

.app-card:hover {
  background: linear-gradient(180deg, var(--surface-primary), var(--accent-softer));
  border-color: rgba(50, 88, 255, 0.28);
}

.app-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.app-icon {
  width: 44px;
  height: 44px;
  min-width: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: #fff;
}

.app-card-meta {
  flex: 1;
  min-width: 0;
}

.app-card-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  line-height: 1.3;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
  flex-shrink: 0;
}

.app-card-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Client ID area */
.app-client-id {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--surface-muted);
  border: 1px solid var(--border-primary);
  cursor: pointer;
}

.app-client-id:hover {
  background: var(--accent-soft);
  border-color: rgba(50, 88, 255, 0.2);
}

.app-client-label {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--text-faint);
  white-space: nowrap;
}

.app-client-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

.app-client-copy {
  color: var(--text-faint);
  flex-shrink: 0;
}

.app-client-id:hover .app-client-copy {
  color: var(--accent);
}

/* Meta info */
.app-card-info {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.app-info-label {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--text-faint);
}

.app-info-value {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* Scope chips */
.app-scopes {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.scope-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--surface-muted);
  border: 1px solid var(--border-primary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--text-muted);
}

.scope-chip-more {
  background: var(--accent-soft);
  border-color: rgba(50, 88, 255, 0.15);
  color: var(--accent);
}

/* Actions */
.app-card-actions {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--border-primary);
}

.app-dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}

.app-dialog-grid {
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

.app-dialog-option,
.app-dialog-alert {
  border: 1px solid var(--border-primary);
  border-radius: 1.25rem;
  background: var(--surface-muted);
  padding: 16px;
}

.app-dialog-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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

.app-dialog-alert--danger {
  border-color: rgba(244, 63, 94, 0.22);
  background: var(--danger-soft);
}

@media (max-width: 640px) {
  .app-dialog-grid {
    grid-template-columns: 1fr;
  }
}

/* Empty state */
.app-empty-state {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  border: 2px dashed var(--border-strong);
  border-radius: 2rem;
  color: var(--text-faint);
  text-align: center;
}

.app-empty-state:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

/* Lumina button styles */
:deep(.lumina-primary-btn) {
  border-radius: 1rem !important;
  font-weight: 900 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.15em !important;
  font-size: 10px !important;
  box-shadow: 0 18px 40px -26px rgba(50, 88, 255, 0.45) !important;
}
:deep(.lumina-primary-btn:active) { opacity: 0.85 !important; }

:deep(.lumina-outline-btn) {
  border-radius: 1rem !important;
  font-weight: 700 !important;
}
:deep(.lumina-outline-btn:active) { opacity: 0.85 !important; }
</style>
