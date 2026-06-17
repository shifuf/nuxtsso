<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { NButton, NInput, NSelect, NSwitch, NTabs, NTabPane, NModal, NRadioGroup, NRadioButton } from 'naive-ui'
import { MessagePlugin, DialogPlugin } from '../../utils/ui'
import { adminApi } from '../../api/admin'
import type {
  SocialProviderConfig,
  SocialIdentityStrategy,
  SocialProfileSyncMode,
  EmailConfig,
  BackupInfo,
  SiteConfig,
} from '../../types/api'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'
import { formatDateTime } from '../../utils/console'
import { foldWechatProviders, getWechatProviderNameByType } from '../../utils/socialProviders'

const activeTab = ref('auth')
const loading = ref(false)
const saving = ref(false)

// ── Auth Config ──
const authConfig = reactive({ requireEmailVerification: false, publicApiEnabled: false })
const siteConfig = reactive<SiteConfig>({
  siteName: '一证通行',
  footerCopyright: '© 2026 一证通行. All rights reserved.',
  icpNumber: '',
})

// ── Social Providers ──
const socialProviders = ref<SocialProviderConfig[]>([])
const visibleSocialProviders = computed(() => foldWechatProviders(socialProviders.value))
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
  fieldMapping: '',
  signatureSecret: '',
  ipWhitelist: '',
  identityStrategy: 'unionid_or_app_openid' as SocialIdentityStrategy,
  profileSyncMode: 'fill_missing' as SocialProfileSyncMode,
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

const intervalOptions = [
  { label: '每 12 小时', value: 12 },
  { label: '每天 02:00', value: 24 },
  { label: '每 48 小时', value: 48 },
]

const identityStrategyOptions = [
  { label: '优先 unionid，无 unionid 时使用 AppID + openid', value: 'unionid_or_app_openid' },
  { label: '必须有 unionid 才允许登录', value: 'unionid_only' },
  { label: '始终使用 AppID + openid', value: 'app_openid' },
  { label: '使用第三方返回的唯一 ID', value: 'provider_user_id' },
]

const profileSyncModeOptions = [
  { label: '只补齐空字段', value: 'fill_missing' },
  { label: '每次登录同步资料', value: 'every_login' },
  { label: '仅首次注册写入资料', value: 'registration_only' },
]

function normalizeProviderType(type?: string | null): SocialProviderConfig['type'] {
  if (type === 'aggregated') return 'aggregated'
  if (type === 'wechat-mini') return 'wechat-mini'
  return 'oauth'
}

onMounted(async () => {
  await loadAll()
})

async function loadAll() {
  loading.value = true
  try {
    const [ac, site, sp, ec, bc, bl] = await Promise.all([
      adminApi.getAuthConfig(),
      adminApi.getSiteConfig(),
      adminApi.listSocialProviders(),
      adminApi.getEmailConfig(),
      adminApi.getBackupConfig(),
      adminApi.listBackups(),
    ])
    authConfig.requireEmailVerification = ac.requireEmailVerification
    authConfig.publicApiEnabled = ac.publicApiEnabled
    if (site) Object.assign(siteConfig, site)
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

async function saveSiteConfig() {
  saving.value = true
  try {
    await adminApi.updateSiteConfig({ ...siteConfig })
    MessagePlugin.success('站点信息已更新')
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
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
  const target = provider.name === 'wechat'
    ? findWechatProviderByType(provider.type)
    : provider
  editingProvider.value = target
  fillProviderForm(target, provider.name === 'wechat' ? 'wechat' : target.name)
  showProviderDialog.value = true
}

function findProviderByName(name: string) {
  return socialProviders.value.find(provider => provider.name === name)
}

function findWechatProviderByType(type?: string | null): SocialProviderConfig {
  const providerType = normalizeProviderType(type)
  const targetName = getWechatProviderNameByType(providerType)
  return findProviderByName(targetName) ?? {
    name: targetName,
    type: providerType,
    enabled: false,
    clientId: '',
    clientSecret: '',
    apiUrl: '',
    redirectUri: '',
    scopes: [],
    authUrl: '',
    tokenUrl: '',
    userInfoUrl: '',
    fieldMapping: '',
    signatureSecret: '',
    ipWhitelist: '',
    identityStrategy: 'unionid_or_app_openid',
    profileSyncMode: 'fill_missing',
    miniProgramUseDynamicCode: true,
    miniProgramSubmitFields: ['jsCode'],
  } satisfies SocialProviderConfig
}

function fillProviderForm(provider: SocialProviderConfig, displayName = provider.name) {
  editingProvider.value = provider
  providerForm.name = displayName
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
  providerForm.fieldMapping = provider.fieldMapping || ''
  providerForm.signatureSecret = provider.signatureSecret || ''
  providerForm.ipWhitelist = provider.ipWhitelist || ''
  providerForm.identityStrategy = provider.identityStrategy || 'unionid_or_app_openid'
  providerForm.profileSyncMode = provider.profileSyncMode || 'fill_missing'
}

function handleProviderTypeChange(type: string) {
  if (providerForm.name !== 'wechat') return
  fillProviderForm(findWechatProviderByType(type), 'wechat')
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

function splitList(value: string) {
  return value.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
}

function closeProviderDialog() {
  showProviderDialog.value = false
}

async function saveProvider() {
  if (!providerForm.name) return MessagePlugin.warning('请填写提供方名称')
  saving.value = true
  try {
    const isAggregated = providerForm.type === 'aggregated'
    const isWechatMini = providerForm.type === 'wechat-mini'
    const isWechat = providerForm.name === 'wechat'
    const targetName = isWechat ? getWechatProviderNameByType(providerForm.type) : providerForm.name
    const usesDefaultWechatPolicy = isWechat || isAggregated || isWechatMini
    const payload = {
      type: providerForm.type || undefined,
      enabled: providerForm.enabled,
      clientId: providerForm.clientId.trim(),
      clientSecret: providerForm.clientSecret.trim(),
      authUrl: isAggregated ? undefined : optionalText(providerForm.authUrl),
      tokenUrl: isAggregated || isWechatMini ? undefined : optionalText(providerForm.tokenUrl),
      userInfoUrl: isAggregated || isWechatMini ? undefined : optionalText(providerForm.userInfoUrl),
      apiUrl: isAggregated ? optionalText(providerForm.apiUrl) : undefined,
      redirectUri: optionalText(providerForm.redirectUri),
      scopes: isWechatMini ? [] : (providerForm.scopes ? splitList(providerForm.scopes) : []),
      fieldMapping: isWechatMini ? undefined : optionalText(providerForm.fieldMapping),
      signatureSecret: isWechatMini ? undefined : providerForm.signatureSecret.trim(),
      ipWhitelist: isWechatMini ? undefined : optionalText(providerForm.ipWhitelist),
      identityStrategy: usesDefaultWechatPolicy ? 'unionid_or_app_openid' : providerForm.identityStrategy,
      profileSyncMode: usesDefaultWechatPolicy ? 'fill_missing' : providerForm.profileSyncMode,
      miniProgramUseDynamicCode: isWechatMini ? true : undefined,
      miniProgramSubmitFields: isWechatMini ? ['jsCode'] : undefined,
    }
    await adminApi.updateSocialProvider(targetName, payload)
    MessagePlugin.success('提供方配置已更新')
    closeProviderDialog()
    await loadAll()
  } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '保存失败') }
  finally { saving.value = false }
}

function providerTypeLabel(type: string) {
  if (type === 'aggregated') return '聚合平台'
  if (type === 'wechat-mini') return '自建小程序'
  return '官方直连'
}

function showProviderPolicyFields() {
  return providerForm.name !== 'wechat' &&
    providerForm.type !== 'wechat-mini' &&
    providerForm.type !== 'aggregated'
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
        <NButton @click="testEmail">发送测试邮件</NButton>
        <NButton type="primary" :loading="saving" @click="saveAuthConfig">保存配置</NButton>
      </template>
    </PageHeader>

    <section class="panel-card p-6">
      <NTabs v-model:value="activeTab">
        <!-- Auth Tab -->
        <NTabPane name="auth" tab="认证与登录">
          <div class="grid gap-6 lg:grid-cols-2">
            <div class="panel-muted p-5">
              <p class="eyebrow">认证策略</p>
              <div class="mt-5 space-y-5">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-[var(--text-primary)]">邮箱验证</p>
                    <p class="mt-1 text-sm text-[var(--text-muted)]">注册、找回密码与验证码登录依赖邮箱验证。</p>
                  </div>
                  <NSwitch v-model:value="authConfig.requireEmailVerification" />
                </div>
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-[var(--text-primary)]">公开 API</p>
                    <p class="mt-1 text-sm text-[var(--text-muted)]">控制是否开放部分匿名元信息接口。</p>
                  </div>
                  <NSwitch v-model:value="authConfig.publicApiEnabled" />
                </div>
              </div>
              <div class="action-row mt-5">
                <NButton type="primary" :loading="saving" @click="saveAuthConfig">保存认证策略</NButton>
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
        </NTabPane>

        <NTabPane name="site" tab="站点信息">
          <div class="grid gap-6 lg:grid-cols-[1fr,0.8fr]">
            <div class="panel-muted p-5">
              <p class="eyebrow">门户页脚配置</p>
              <div class="mt-5 space-y-4">
                <NInput v-model:value="siteConfig.siteName" size="large" placeholder="站点名称" />
                <NInput v-model:value="siteConfig.footerCopyright" size="large" placeholder="版权信息" />
                <NInput v-model:value="siteConfig.icpNumber" size="large" placeholder="例如：京ICP备00000000号-1" />
              </div>
              <div class="action-row mt-5">
                <NButton type="primary" :loading="saving" @click="saveSiteConfig">保存站点信息</NButton>
              </div>
            </div>

            <div class="panel-muted p-5">
              <p class="eyebrow">页脚预览</p>
              <div class="mt-5 rounded-2xl border border-[var(--border-primary)] bg-[#0f172a] p-5 text-center">
                <p class="text-sm font-semibold text-slate-200">{{ siteConfig.footerCopyright }}</p>
                <p v-if="siteConfig.icpNumber" class="mt-2 text-xs text-slate-400">{{ siteConfig.icpNumber }}</p>
              </div>
            </div>
          </div>
        </NTabPane>

        <!-- Social Tab -->
        <NTabPane name="social" tab="第三方登录">
          <div class="panel-muted p-5">
            <div class="flex items-center justify-between gap-3">
              <p class="eyebrow">提供方配置</p>
              <NButton size="small" :loading="saving" @click="initProviders">初始化默认提供方</NButton>
            </div>
            <div class="mt-4 grid gap-3">
              <div
                v-for="provider in visibleSocialProviders"
                :key="provider.name"
                class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-[var(--text-primary)]">{{ provider.name }}</p>
                    <p class="mt-1 text-sm text-[var(--text-muted)]">{{ providerTypeLabel(provider.type) }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <StatusTag :tone="provider.enabled ? 'success' : 'warning'" :label="provider.enabled ? '已启用' : '未启用'" />
                    <NButton size="small" class="action-tag action-edit" @click="openProviderEdit(provider)">编辑</NButton>
                    <NButton size="small" class="action-tag action-delete" @click="deleteProvider(provider.name)">删除</NButton>
                  </div>
                </div>
              </div>
              <div v-if="visibleSocialProviders.length === 0" class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4">
                <p class="text-sm text-[var(--text-muted)]">暂未配置第三方提供方，点击"初始化默认提供方"快速创建。</p>
              </div>
            </div>
          </div>
        </NTabPane>

        <!-- Mail Tab -->
        <NTabPane name="mail" tab="邮件服务">
          <div class="grid gap-6 lg:grid-cols-2">
            <div class="panel-muted p-5">
              <p class="eyebrow">SMTP 配置</p>
              <div class="mt-4 space-y-4">
                <div class="grid gap-4 sm:grid-cols-2">
                  <NInput v-model:value="emailConfig.host" size="large" placeholder="SMTP 服务器" />
                  <NInput :value="String(emailConfig.port)" size="large" placeholder="端口" @update:value="(v) => emailConfig.port = Number(v) || 0" />
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <NInput v-model:value="emailConfig.username" size="large" placeholder="用户名" />
                  <NInput v-model:value="emailConfig.password" type="password" size="large" placeholder="密码" />
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <NInput v-model:value="emailConfig.fromName" size="large" placeholder="发件人名称" />
                  <NInput v-model:value="emailConfig.fromAddress" size="large" placeholder="发件人地址" />
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm text-[var(--text-primary)]">使用 SSL/TLS</span>
                  <NSwitch v-model:value="emailConfig.secure" />
                </div>
              </div>
              <div class="action-row mt-4">
                <NButton type="primary" :loading="saving" @click="saveEmailConfig">保存邮件配置</NButton>
              </div>
            </div>

            <div class="panel-muted p-5">
              <p class="eyebrow">测试邮件</p>
              <div class="mt-4 space-y-4">
                <NInput v-model:value="testEmailAddress" size="large" placeholder="收件人邮箱（留空使用发件人地址）" />
                <NButton :loading="saving" block @click="testEmail">发送测试邮件</NButton>
              </div>
            </div>
          </div>
        </NTabPane>

        <!-- Ops Tab -->
        <NTabPane name="ops" tab="服务与运维">
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
                  <NSelect
                    v-model:value="backupConfig.intervalHours"
                    size="large"
                    :options="intervalOptions"
                  />
                  <NInput :value="String(backupConfig.retentionCount)" size="large" placeholder="保留份数" @update:value="(v) => backupConfig.retentionCount = Number(v) || 0" />
                </div>
                <div class="mt-4 flex items-center justify-between gap-3">
                  <span class="text-sm text-[var(--text-primary)]">压缩备份</span>
                  <NSwitch v-model:value="backupConfig.compress" />
                </div>
                <div class="action-row mt-4">
                  <NButton :loading="saving" @click="createBackup">手动备份</NButton>
                  <NButton type="primary" :loading="saving" @click="saveBackupConfig">保存策略</NButton>
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
                          <NButton size="small" class="action-tag action-reset" @click="restoreBackup(item.filename)">恢复</NButton>
                          <NButton size="small" class="action-tag action-delete" @click="deleteBackup(item.filename)">删除</NButton>
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
        </NTabPane>
      </NTabs>
    </section>

    <!-- Provider Edit Dialog -->
    <NModal
      v-model:show="showProviderDialog"
      preset="card"
      title="编辑提供方配置"
      style="width: min(760px, 92vw)"
      @close="closeProviderDialog"
    >
      <div class="space-y-4 pt-2">
        <NInput v-model:value="providerForm.name" size="large" placeholder="提供方名称" disabled />
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-[var(--text-primary)]">来源类型</span>
          <NRadioGroup v-model:value="providerForm.type" @update:value="handleProviderTypeChange">
            <NRadioButton value="oauth">官方直连</NRadioButton>
            <NRadioButton value="aggregated">聚合平台</NRadioButton>
            <NRadioButton v-if="providerForm.name === 'wechat'" value="wechat-mini">自建小程序</NRadioButton>
          </NRadioGroup>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-[var(--text-primary)]">启用</span>
          <NSwitch v-model:value="providerForm.enabled" />
        </div>
        <NInput
          v-model:value="providerForm.clientId"
          size="large"
          :placeholder="providerForm.type === 'wechat-mini' ? '小程序 AppID' : 'Client ID / AppID'"
        />
        <NInput
          v-model:value="providerForm.clientSecret"
          size="large"
          type="password"
          :placeholder="providerForm.type === 'wechat-mini' ? '小程序 AppSecret' : 'Client Secret / AppSecret'"
        />
        <div v-if="showProviderPolicyFields()" class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-2">
            <span class="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">身份策略</span>
            <NSelect
              v-model:value="providerForm.identityStrategy"
              size="large"
              :options="identityStrategyOptions"
            />
          </div>
          <div class="space-y-2">
            <span class="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">资料同步</span>
            <NSelect
              v-model:value="providerForm.profileSyncMode"
              size="large"
              :options="profileSyncModeOptions"
            />
          </div>
        </div>
        <template v-if="providerForm.type === 'aggregated'">
          <NInput v-model:value="providerForm.apiUrl" size="large" placeholder="聚合 API 地址" />
        </template>
        <template v-else-if="providerForm.type === 'wechat-mini'">
          <NInput v-model:value="providerForm.authUrl" size="large" placeholder="固定小程序码图片 URL（可选兜底）" />
          <NInput v-model:value="providerForm.redirectUri" size="large" placeholder="小程序登录页路径（默认 pages/wechat-scan-login/wechat-scan-login）" />
        </template>
        <template v-else>
          <NInput v-model:value="providerForm.authUrl" size="large" placeholder="Auth URL" />
          <NInput v-model:value="providerForm.tokenUrl" size="large" placeholder="Token URL" />
          <NInput v-model:value="providerForm.userInfoUrl" size="large" placeholder="UserInfo URL" />
          <NInput v-model:value="providerForm.redirectUri" size="large" placeholder="授权回调域名或完整回调地址（可选）" />
        </template>
        <template v-if="providerForm.type !== 'wechat-mini'">
          <NInput v-model:value="providerForm.scopes" type="textarea" placeholder="Scopes（每行一个）" :autosize="{ minRows: 1, maxRows: 3 }" />
          <NInput v-model:value="providerForm.fieldMapping" type="textarea" placeholder="字段映射 JSON（可选，例如 providerUserId/nickname/avatar/email/phone/openid/unionid）" :autosize="{ minRows: 2, maxRows: 4 }" />
          <NInput v-model:value="providerForm.signatureSecret" size="large" type="password" placeholder="HMAC-SHA256 签名密钥（可选，按回调参数 key 排序，排除 sign/signature）" />
          <NInput v-model:value="providerForm.ipWhitelist" type="textarea" placeholder="IP 白名单（可选，每行一个或 JSON 数组）" :autosize="{ minRows: 1, maxRows: 3 }" />
        </template>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="closeProviderDialog">取消</NButton>
          <NButton type="primary" :loading="saving" @click="saveProvider">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
