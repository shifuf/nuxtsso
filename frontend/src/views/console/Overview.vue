<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi } from '../../api/admin'
import type { ApplicationItem, AuditLogItem, AuditSummary, SocialProviderConfig } from '../../types/api'
import { formatAuditAction, formatAuditCategory, formatCount, formatDateTime } from '../../utils/console'
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
      title="运营概览"
    >
      <template #actions>
        <t-button variant="outline" @click="loadData">刷新</t-button>
        <t-button theme="primary" @click="$router.push('/user/applications')">新建应用</t-button>
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

    <div class="overview-grid">
      <section class="panel-card overview-app-panel">
        <div class="page-header">
          <div>
            <p class="eyebrow">接入应用</p>
            <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">在线应用与回调配置</h2>
          </div>
          <StatusTag tone="info" label="按 Client ID 扫描" />
        </div>

        <div class="overview-app-strip">
          <div>
            <p class="overview-number">{{ activeApps() }}</p>
            <p class="overview-label">启用应用</p>
          </div>
          <div>
            <p class="overview-number">{{ applications.length }}</p>
            <p class="overview-label">接入总数</p>
          </div>
          <div>
            <p class="overview-number">{{ applications.reduce((sum, app) => sum + app.redirectUris.length, 0) }}</p>
            <p class="overview-label">回调地址</p>
          </div>
        </div>

        <div class="overview-app-list">
          <article v-for="app in applications.slice(0, 6)" :key="app.id" class="overview-app-item">
            <div class="overview-app-main">
              <div class="overview-app-avatar">{{ app.name.slice(0, 1) }}</div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate font-semibold text-[var(--text-primary)]">{{ app.name }}</p>
                  <StatusTag :tone="app.status === 'active' ? 'success' : 'danger'" :label="app.status === 'active' ? '启用' : '禁用'" />
                </div>
                <p class="mt-1 truncate font-mono text-xs text-[var(--text-muted)]">{{ app.clientId }}</p>
              </div>
            </div>
            <div class="overview-app-meta">
              <span>{{ app.scopes.length }} scopes</span>
              <StatusTag :tone="app.allowRegistration ? 'info' : 'neutral'" :label="app.allowRegistration ? '允许注册' : '仅登录'" />
            </div>
            <p class="overview-callback">{{ app.redirectUris[0] || '未配置回调地址' }}</p>
          </article>
          <div v-if="applications.length === 0 && !loading" class="panel-muted p-4 text-center">
            <p class="text-sm text-[var(--text-muted)]">暂无接入应用</p>
          </div>
        </div>
      </section>

      <div class="overview-side">
        <section class="panel-card overview-card">
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
                  <StatusTag :tone="logTone(log.category)" :label="formatDateTime(log.createdAt)" />
                </div>
                <p class="mt-2 text-sm text-[var(--text-secondary)]">{{ log.actorEmail || log.actorName || 'system' }} · {{ log.category }}</p>
              </div>
            </div>
            <div v-if="recentLogs.length === 0 && !loading" class="panel-muted p-4 text-center">
              <p class="text-sm text-[var(--text-muted)]">暂无近期事件</p>
            </div>
          </div>
        </section>

        <section class="panel-card overview-card">
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

<style scoped>
.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
  gap: 24px;
  align-items: start;
}

.overview-app-panel,
.overview-card {
  padding: 24px;
}

.overview-side {
  display: grid;
  gap: 24px;
}

.overview-app-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.overview-app-strip > div {
  border: 1px solid var(--border-primary);
  border-radius: 18px;
  padding: 16px;
  background: var(--surface-muted);
}

.overview-number {
  margin: 0;
  color: var(--text-primary);
  font-size: 30px;
  font-weight: 950;
  line-height: 1;
  letter-spacing: -0.04em;
}

.overview-label {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.overview-app-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.overview-app-item {
  min-width: 0;
  border: 1px solid var(--border-primary);
  border-radius: 18px;
  padding: 16px;
  background: var(--surface-secondary);
}

.overview-app-main {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.overview-app-avatar {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 12px;
  background: var(--surface-muted);
  color: var(--accent);
  font-weight: 900;
}

.overview-app-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.overview-callback {
  margin: 12px 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }

  .overview-side {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .overview-app-panel,
  .overview-card {
    padding: 18px;
  }

  .overview-side,
  .overview-app-list,
  .overview-app-strip {
    grid-template-columns: 1fr;
  }
}
</style>
