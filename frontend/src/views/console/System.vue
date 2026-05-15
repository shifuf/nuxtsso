<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { adminApi } from '../../api/admin'
import type { SocialProviderConfig, EmailConfig, BackupInfo } from '../../types/api'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'
import { formatDateTime } from '../../utils/console'

const activeTab = ref('auth')
const loading = ref(false)
const saving = ref(false)

// ── Auth Config ──
const authConfig = reactive({ requireEmailVerification: false, publicApiEnabled: false })

// ── Social Providers ──
const socialProviders = ref<SocialProviderConfig[]>([])
const editingProvider = ref<SocialProviderConfig | null>(null)
const showProviderDialog = ref(false)
const providerForm = reactive({
  name: '',
  type: 'oauth' as string,
  enabled: true,
  clientId: '',
  clientSecret: '',
  authUrl: '',
  tokenUrl: '',
  userInfoUrl: '',
  apiUrl: '',
  redirectUri: '',
  scopes: '',
})

// ── Email Config ──
const emailConfig = reactive<EmailConfig>({
  host: '', port: 587, secure: false, username: '', password: '',
  fromName: '', fromAddress: '',
})
const testEmailAddress = ref('')

// ── Backup ──
const backupConfig = reactive({ enabled: true, intervalHours: 24, retentionCount: 14, compress: true })
const backups = ref<BackupInfo[]>([])

const endpoints = [
  '/.well-known/openid-configuration',
  '/oauth2/authorize',
  '/oauth2/token',
  '/oauth2/userinfo',
  '/oauth2/jwks',
]

onMounted(async () => {
  await loadAll()
})

async function loadAll() {
  loading.value = true
  try {
    const [ac, sp, ec, bc, bl] = await Promise.all([
      adminApi.getAuthConfig(),
      adminApi.listSocialProviders(),
      adminApi.getEmailConfig(),
      adminApi.getBackupConfig(),
      adminApi.listBackups(),
    ])
    authConfig.requireEmailVerification = ac.requireEmailVerification
    authConfig.publicApiEnabled = ac.publicApiEnabled
    socialProviders.value = sp || []
    if (ec) Object.assign(emailConfig, ec)
    if (bc) {
      backupConfig.enabled = bc.enabled
      backupConfig.intervalHours = bc.intervalHours
      backupConfig.retentionCount = bc.retentionCount
      backupConfig.compress = bc.compress
    }
    backups.value = bl || []
  } catch { /* some APIs may not be configured yet */ }
  finally { loading.value = false }
}

// ── Auth ──
async function saveAuthConfig() {
  saving.value = true
  try {
    await adminApi.updateAuthConfig({
      requireEmailVerification: authConfig.requireEmailVerification,
      publicApiEnabled: authConfig.publicApiEnabled,
    })
    MessagePlugin.success('认证策略已更新')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
}

// ── Social ──
function openProviderEdit(provider: SocialProviderConfig) {
  editingProvider.value = provider
  providerForm.name = provider.name
  providerForm.type = provider.type
  providerForm.enabled = provider.enabled
  providerForm.clientId = provider.clientId
  providerForm.clientSecret = provider.clientSecret
  providerForm.authUrl = provider.authUrl
  providerForm.tokenUrl = provider.tokenUrl
  providerForm.userInfoUrl = provider.userInfoUrl
  providerForm.apiUrl = provider.apiUrl || ''
  providerForm.redirectUri = provider.redirectUri || ''
  providerForm.scopes = provider.scopes?.join('\n') || ''
  showProviderDialog.value = true
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

function closeProviderDialog() {
  showProviderDialog.value = false
}

async function saveProvider() {
  if (!providerForm.name) return MessagePlugin.warning('请填写提供方名称')
  saving.value = true
  try {
    const isAggregated = providerForm.type === 'aggregated'
    const payload = {
      type: providerForm.type || undefined,
      enabled: providerForm.enabled,
      clientId: providerForm.clientId.trim(),
      clientSecret: providerForm.clientSecret.trim(),
      authUrl: isAggregated ? undefined : optionalText(providerForm.authUrl),
      tokenUrl: isAggregated ? undefined : optionalText(providerForm.tokenUrl),
      userInfoUrl: isAggregated ? undefined : optionalText(providerForm.userInfoUrl),
      apiUrl: isAggregated ? optionalText(providerForm.apiUrl) : undefined,
      redirectUri: optionalText(providerForm.redirectUri),
      scopes: providerForm.scopes ? providerForm.scopes.split('\n').map(s => s.trim()).filter(Boolean) : [],
    }
    await adminApi.updateSocialProvider(providerForm.name, payload)
    MessagePlugin.success('提供方配置已更新')
    closeProviderDialog()
    await loadAll()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
}

async function initProviders() {
  saving.value = true
  try {
    await adminApi.initSocialProviders()
    MessagePlugin.success('提供方已初始化')
    await loadAll()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '初始化失败') }
  finally { saving.value = false }
}

async function deleteProvider(name: string) {
  const dialog = DialogPlugin.confirm({
    header: '删除提供方',
    body: `确定要删除 "${name}" 的第三方登录配置吗？`,
    confirmBtn: '确认删除',
    cancelBtn: '取消',
    theme: 'danger',
    onConfirm: async () => {
      try {
        await adminApi.deleteSocialProvider(name)
        MessagePlugin.success('提供方已删除')
        await loadAll()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '删除失败') }
      dialog.hide()
    },
  })
}

// ── Email ──
async function saveEmailConfig() {
  saving.value = true
  try {
    await adminApi.updateEmailConfig({ ...emailConfig })
    MessagePlugin.success('邮件配置已更新')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
}

async function testEmail() {
  saving.value = true
  try {
    const result = await adminApi.testEmailConfig(testEmailAddress.value || undefined)
    MessagePlugin.success(result.message || '测试邮件已发送')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '测试失败') }
  finally { saving.value = false }
}

// ── Backup ──
async function saveBackupConfig() {
  saving.value = true
  try {
    await adminApi.updateBackupConfig({
      enabled: backupConfig.enabled,
      intervalHours: backupConfig.intervalHours,
      retentionCount: backupConfig.retentionCount,
      compress: backupConfig.compress,
    })
    MessagePlugin.success('备份策略已更新')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
}

async function createBackup() {
  saving.value = true
  try {
    await adminApi.createBackup()
    MessagePlugin.success('备份任务已创建')
    await loadAll()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '备份失败') }
  finally { saving.value = false }
}

async function restoreBackup(filename: string) {
  const dialog = DialogPlugin.confirm({
    header: '恢复备份',
    body: `确定要从 "${filename}" 恢复数据库吗？当前数据将被覆盖，该操作不可撤销。`,
    confirmBtn: '确认恢复',
    cancelBtn: '取消',
    theme: 'danger',
    onConfirm: async () => {
      try {
        await adminApi.restoreBackup(filename)
        MessagePlugin.success('恢复任务已启动')
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '恢复失败') }
      dialog.hide()
    },
  })
}

async function deleteBackup(filename: string) {
  const dialog = DialogPlugin.confirm({
    header: '删除备份',
    body: `确定要删除 "${filename}" 吗？该操作不可撤销。`,
    confirmBtn: '确认删除',
    cancelBtn: '取消',
    theme: 'danger',
    onConfirm: async () => {
      try {
        await adminApi.deleteBackup(filename)
        MessagePlugin.success('备份已删除')
        await loadAll()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '删除失败') }
      dialog.hide()
    },
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="系统设置"
    >
      <template #actions>
        <t-button variant="outline" @click="testEmail">发送测试邮件</t-button>
        <t-button theme="primary" :loading="saving" @click="saveAuthConfig">保存配置</t-button>
      </template>
    </PageHeader>

    <section class="panel-card p-6">
      <t-tabs v-model="activeTab">
        <!-- Auth Tab -->
        <t-tab-panel value="auth" label="认证与登录">
          <div class="grid gap-6 lg:grid-cols-2">
            <div class="panel-muted p-5">
              <p class="eyebrow">认证策略</p>
              <div class="mt-5 space-y-5">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-[var(--text-primary)]">邮箱验证</p>
                    <p class="mt-1 text-sm text-[var(--text-muted)]">注册、找回密码与验证码登录依赖邮箱验证。</p>
                  </div>
                  <t-switch v-model="authConfig.requireEmailVerification" />
                </div>
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-[var(--text-primary)]">公开 API</p>
                    <p class="mt-1 text-sm text-[var(--text-muted)]">控制是否开放部分匿名元信息接口。</p>
                  </div>
                  <t-switch v-model="authConfig.publicApiEnabled" />
                </div>
              </div>
              <div class="action-row mt-5">
                <t-button theme="primary" :loading="saving" @click="saveAuthConfig">保存认证策略</t-button>
              </div>
            </div>

            <div class="panel-muted p-5">
              <p class="eyebrow">当前说明</p>
              <div class="mt-4 space-y-3">
                <div class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4">
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-semibold text-[var(--text-primary)]">注册入口控制</p>
                    <StatusTag tone="info" label="OAuth 场景开放" />
                  </div>
                </div>
                <div class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4">
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-semibold text-[var(--text-primary)]">密码登录</p>
                    <StatusTag tone="success" label="默认启用" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </t-tab-panel>

        <!-- Social Tab -->
        <t-tab-panel value="social" label="第三方登录">
          <div class="panel-muted p-5">
            <div class="flex items-center justify-between gap-3">
              <p class="eyebrow">提供方配置</p>
              <t-button variant="outline" size="small" :loading="saving" @click="initProviders">初始化默认提供方</t-button>
            </div>
            <div class="mt-4 grid gap-3">
              <div
                v-for="provider in socialProviders"
                :key="provider.name"
                class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-[var(--text-primary)]">{{ provider.name }}</p>
                    <p class="mt-1 text-sm text-[var(--text-muted)]">{{ provider.type === 'aggregated' ? '聚合平台' : '官方直连' }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <StatusTag :tone="provider.enabled ? 'success' : 'warning'" :label="provider.enabled ? '已启用' : '未启用'" />
                    <t-button variant="outline" size="small" @click="openProviderEdit(provider)">编辑</t-button>
                    <t-button variant="outline" size="small" theme="danger" @click="deleteProvider(provider.name)">删除</t-button>
                  </div>
                </div>
              </div>
              <div v-if="socialProviders.length === 0" class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4">
                <p class="text-sm text-[var(--text-muted)]">暂未配置第三方提供方，点击"初始化默认提供方"快速创建。</p>
              </div>
            </div>
          </div>
        </t-tab-panel>

        <!-- Mail Tab -->
        <t-tab-panel value="mail" label="邮件服务">
          <div class="grid gap-6 lg:grid-cols-2">
            <div class="panel-muted p-5">
              <p class="eyebrow">SMTP 配置</p>
              <div class="mt-4 space-y-4">
                <div class="grid gap-4 sm:grid-cols-2">
                  <t-input v-model="emailConfig.host" size="large" placeholder="SMTP 服务器" />
                  <t-input v-model.number="emailConfig.port" size="large" placeholder="端口" />
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <t-input v-model="emailConfig.username" size="large" placeholder="用户名" />
                  <t-input v-model="emailConfig.password" type="password" size="large" placeholder="密码" />
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <t-input v-model="emailConfig.fromName" size="large" placeholder="发件人名称" />
                  <t-input v-model="emailConfig.fromAddress" size="large" placeholder="发件人地址" />
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm text-[var(--text-primary)]">使用 SSL/TLS</span>
                  <t-switch v-model="emailConfig.secure" />
                </div>
              </div>
              <div class="action-row mt-4">
                <t-button theme="primary" :loading="saving" @click="saveEmailConfig">保存邮件配置</t-button>
              </div>
            </div>

            <div class="panel-muted p-5">
              <p class="eyebrow">测试邮件</p>
              <div class="mt-4 space-y-4">
                <t-input v-model="testEmailAddress" size="large" placeholder="收件人邮箱（留空使用发件人地址）" />
                <t-button variant="outline" :loading="saving" block @click="testEmail">发送测试邮件</t-button>
              </div>
            </div>
          </div>
        </t-tab-panel>

        <!-- Ops Tab -->
        <t-tab-panel value="ops" label="服务与运维">
          <div class="space-y-6">
            <div class="grid gap-6 lg:grid-cols-2">
              <div class="panel-muted p-5">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="eyebrow">备份策略</p>
                    <h2 class="mt-2 text-lg font-semibold text-[var(--text-primary)]">自动备份与恢复</h2>
                  </div>
                  <StatusTag tone="warning" label="恢复将覆盖当前数据库状态" />
                </div>

                <div class="mt-4 grid gap-4 sm:grid-cols-2">
                  <t-select
                    v-model="backupConfig.intervalHours"
                    size="large"
                    :options="[
                      { label: '每 12 小时', value: 12 },
                      { label: '每天 02:00', value: 24 },
                      { label: '每 48 小时', value: 48 },
                    ]"
                  />
                  <t-input v-model.number="backupConfig.retentionCount" size="large" placeholder="保留份数" />
                </div>
                <div class="mt-4 flex items-center justify-between gap-3">
                  <span class="text-sm text-[var(--text-primary)]">压缩备份</span>
                  <t-switch v-model="backupConfig.compress" />
                </div>
                <div class="action-row mt-4">
                  <t-button variant="outline" :loading="saving" @click="createBackup">手动备份</t-button>
                  <t-button theme="primary" :loading="saving" @click="saveBackupConfig">保存策略</t-button>
                </div>
              </div>

              <div class="panel-muted p-5">
                <p class="eyebrow">公开端点</p>
                <div class="mt-4 space-y-3">
                  <div
                    v-for="endpoint in endpoints"
                    :key="endpoint"
                    class="code-pill w-full justify-between"
                  >
                    <span>{{ endpoint }}</span>
                    <StatusTag tone="info" label="公开" />
                  </div>
                </div>
              </div>
            </div>

            <div class="table-shell">
              <div class="table-scroll">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>文件名</th>
                      <th>大小</th>
                      <th>创建时间</th>
                      <th>触发方式</th>
                      <th>格式</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in backups" :key="item.filename">
                      <td class="font-mono text-xs">{{ item.filename }}</td>
                      <td>{{ formatBytes(item.size) }}</td>
                      <td class="font-mono text-xs">{{ formatDateTime(item.createdAt) }}</td>
                      <td>{{ item.trigger === 'manual' ? '手动' : '自动' }}</td>
                      <td>{{ item.compressed ? 'gzip' : '原始' }}</td>
                      <td>
                        <div class="flex gap-2">
                          <t-button variant="outline" size="small" theme="warning" @click="restoreBackup(item.filename)">恢复</t-button>
                          <t-button variant="outline" size="small" theme="danger" @click="deleteBackup(item.filename)">删除</t-button>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="backups.length === 0 && !loading">
                      <td colspan="6" class="text-center py-8 text-[var(--text-muted)]">暂无备份文件</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </t-tab-panel>
      </t-tabs>
    </section>

    <!-- Provider Edit Dialog -->
    <t-dialog
      v-model:visible="showProviderDialog"
      header="编辑提供方配置"
      width="600px"
      :confirm-btn="{ content: '保存', theme: 'primary', loading: saving }"
      :cancel-btn="{ content: '取消', variant: 'outline' }"
      @confirm="saveProvider"
      @cancel="closeProviderDialog"
      @close="closeProviderDialog"
    >
      <div class="space-y-4 pt-2">
        <t-input v-model="providerForm.name" size="large" placeholder="提供方名称" disabled />
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-[var(--text-primary)]">来源类型</span>
          <t-radio-group v-model="providerForm.type">
            <t-radio-button value="oauth">官方直连</t-radio-button>
            <t-radio-button value="aggregated">聚合平台</t-radio-button>
          </t-radio-group>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-[var(--text-primary)]">启用</span>
          <t-switch v-model="providerForm.enabled" />
        </div>
        <t-input v-model="providerForm.clientId" size="large" placeholder="Client ID" />
        <t-input v-model="providerForm.clientSecret" size="large" type="password" placeholder="Client Secret" />
        <template v-if="providerForm.type === 'aggregated'">
          <t-input v-model="providerForm.apiUrl" size="large" placeholder="聚合 API 地址" />
        </template>
        <template v-else>
          <t-input v-model="providerForm.authUrl" size="large" placeholder="Auth URL" />
          <t-input v-model="providerForm.tokenUrl" size="large" placeholder="Token URL" />
          <t-input v-model="providerForm.userInfoUrl" size="large" placeholder="UserInfo URL" />
        </template>
        <t-input v-model="providerForm.redirectUri" size="large" placeholder="Redirect URI（可选）" />
        <t-textarea v-model="providerForm.scopes" placeholder="Scopes（每行一个）" :autosize="{ minRows: 1, maxRows: 3 }" />
      </div>
    </t-dialog>
  </div>
</template>
