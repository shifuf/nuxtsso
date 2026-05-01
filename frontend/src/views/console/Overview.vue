<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi } from '../../api/admin'
import type { ApplicationItem, AuditLogItem, AuditSummary, SocialProviderConfig } from '../../types/api'
import { formatAuditAction, formatAuditCategory, formatCount } from '../../utils/console'
import MetricCard from '../../components/MetricCard.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'

const loading = ref(false)
const applications = ref<ApplicationItem[]>([])
const auditSummary = ref<AuditSummary | null>(null)
const socialProviders = ref<SocialProviderConfig[]>([])
const recentLogs = ref<AuditLogItem[]>([])

onMounted(async () => {
  await loadData()
})

async function loadData() {
  loading.value = true
  try {
    const [apps, summary, providers, logs] = await Promise.all([
      adminApi.listApplications(),
      adminApi.getAuditSummary(7),
      adminApi.listSocialProviders(),
      adminApi.listAuditLogs({ limit: 5 }),
    ])
    applications.value = apps || []
    auditSummary.value = summary
    socialProviders.value = providers || []
    recentLogs.value = logs || []
  } catch { /* silent */ }
  finally { loading.value = false }
}

const activeApps = () => applications.value.filter(a => a.status === 'active').length
const enabledProviders = () => socialProviders.value.filter(p => p.enabled).length
const totalProviders = () => socialProviders.value.length

function categoryTone(category: string): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  const map: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
    auth: 'info', oauth2: 'warning', admin: 'success', system: 'neutral',
  }
  return map[category] || 'neutral'
}

function logTone(category: string): 'success' | 'info' | 'warning' | 'danger' {
  const map: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
    auth: 'info', oauth2: 'warning', admin: 'success', system: 'neutral' as 'info',
  }
  return map[category] || 'info'
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      eyebrow="管理员视角"
      title="运营概览"
      description="优先展示活跃账号、在线应用、近期事件和第三方入口状态，帮助快速判断认证中心是否稳定运行。"
    >
      <template #actions>
        <t-button variant="outline" @click="loadData">刷新</t-button>
        <t-button theme="primary" @click="$router.push('/console/applications')">新建应用</t-button>
      </template>
    </PageHeader>

    <div class="metric-grid">
      <MetricCard
        label="活跃账号"
        :value="auditSummary ? formatCount(auditSummary.uniqueActors) : '—'"
        caption="近 7 天活跃账号数"
        trend="近 7 天"
        tone="info"
      />
      <MetricCard
        label="在线应用"
        :value="String(activeApps())"
        caption="已接入并处于启用状态"
        :trend="applications.length ? '全部在线' : '无'"
        tone="success"
      />
      <MetricCard
        label="24h 事件"
        :value="auditSummary ? formatCount(auditSummary.last24Hours) : '—'"
        caption="认证、授权与后台事件总量"
        :trend="auditSummary ? `+${auditSummary.last24Hours}` : '—'"
        tone="warning"
      />
      <MetricCard
        label="第三方入口"
        :value="`${enabledProviders()}/${totalProviders()}`"
        caption="已启用提供方 / 已配置提供方"
        :trend="totalProviders() - enabledProviders() > 0 ? `${totalProviders() - enabledProviders()} 项待完成` : '全部就绪'"
        tone="neutral"
      />
    </div>

    <div class="grid gap-6 xl:grid-cols-[1.6fr,0.95fr]">
      <section class="panel-card p-6">
        <div class="page-header">
          <div>
            <p class="eyebrow">接入应用</p>
            <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">在线应用与回调配置</h2>
          </div>
          <StatusTag tone="info" label="按 Client ID 扫描" />
        </div>

        <div class="table-shell mt-5">
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>应用</th>
                  <th>Client ID</th>
                  <th>状态</th>
                  <th>Scopes</th>
                  <th>注册策略</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="app in applications.slice(0, 10)" :key="app.id">
                  <td>
                    <p class="font-semibold text-[var(--text-primary)]">{{ app.name }}</p>
                  </td>
                  <td class="font-mono text-xs">{{ app.clientId }}</td>
                  <td>
                    <StatusTag :tone="app.status === 'active' ? 'success' : 'danger'" :label="app.status === 'active' ? '启用' : '禁用'" />
                  </td>
                  <td class="text-sm">{{ app.scopes.length }}</td>
                  <td>
                    <StatusTag :tone="app.allowRegistration ? 'info' : 'neutral'" :label="app.allowRegistration ? '允许注册' : '仅登录'" />
                  </td>
                </tr>
                <tr v-if="applications.length === 0 && !loading">
                  <td colspan="5" class="text-center py-8 text-[var(--text-muted)]">暂无接入应用</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div class="space-y-6">
        <section class="panel-card p-6">
          <div class="page-header">
            <div>
              <p class="eyebrow">最新事件</p>
              <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">事件时间线</h2>
            </div>
            <StatusTag tone="success" label="实时" />
          </div>

          <div class="timeline-list mt-5">
            <div v-for="log in recentLogs" :key="log.id" class="timeline-item">
              <div class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-muted)] px-4 py-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <p class="text-sm font-semibold text-[var(--text-primary)]">{{ formatAuditAction(log.action) }}</p>
                  <StatusTag :tone="logTone(log.category)" :label="new Date(log.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })" />
                </div>
                <p class="mt-2 text-sm text-[var(--text-secondary)]">{{ log.actorEmail || log.actorName || 'system' }} · {{ log.category }}</p>
              </div>
            </div>
            <div v-if="recentLogs.length === 0 && !loading" class="panel-muted p-4 text-center">
              <p class="text-sm text-[var(--text-muted)]">暂无近期事件</p>
            </div>
          </div>
        </section>

        <section class="panel-card p-6">
          <p class="eyebrow">第三方入口状态</p>
          <div class="stack-list mt-5">
            <div
              v-for="provider in socialProviders"
              :key="provider.name"
              class="panel-muted stack-item"
            >
              <div>
                <div class="flex items-center gap-2">
                  <p class="text-sm font-semibold text-[var(--text-primary)]">{{ provider.name }}</p>
                  <StatusTag :tone="provider.enabled ? 'success' : 'warning'" :label="provider.enabled ? '已启用' : '未启用'" />
                </div>
                <p class="mt-2 text-sm leading-6 text-[var(--text-muted)]">{{ provider.type === 'aggregated' ? '聚合平台登录入口' : '官方直连 OAuth' }}</p>
              </div>
            </div>
            <div v-if="socialProviders.length === 0 && !loading" class="panel-muted p-4 text-center">
              <p class="text-sm text-[var(--text-muted)]">后台尚未配置第三方登录提供方</p>
            </div>
          </div>
        </section>
      </div>
    </div>

    <section class="panel-card p-6">
      <div class="page-header">
        <div>
          <p class="eyebrow">高频操作</p>
          <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">动作分布</h2>
        </div>
        <StatusTag tone="neutral" label="统一命名" />
      </div>

      <div class="mt-5 grid gap-4 lg:grid-cols-4">
        <div v-for="item in auditSummary?.topActions?.slice(0, 8) || []" :key="item.action" class="panel-muted p-4">
          <div class="flex items-center justify-between gap-3">
            <StatusTag :tone="categoryTone(item.category)" :label="formatAuditCategory(item.category)" />
            <span class="font-mono text-sm text-[var(--text-muted)]">{{ formatCount(item.count) }}</span>
          </div>
          <p class="mt-4 break-all font-mono text-sm text-[var(--text-primary)]">{{ formatAuditAction(item.action) }}</p>
        </div>
        <div v-if="!auditSummary?.topActions?.length && !loading" class="col-span-full panel-muted p-4 text-center">
          <p class="text-sm text-[var(--text-muted)]">暂无操作统计</p>
        </div>
      </div>
    </section>
  </div>
</template>
