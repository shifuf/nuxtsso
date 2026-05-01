<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { adminApi } from '../../api/admin'
import type { AuditLogItem, AuditSummary, AuditCategory } from '../../types/api'
import { formatAuditAction, formatAuditCategory, formatCount } from '../../utils/console'
import MetricCard from '../../components/MetricCard.vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'

const loading = ref(false)
const logs = ref<AuditLogItem[]>([])
const summary = ref<AuditSummary | null>(null)

const filters = ref({
  category: '' as AuditCategory | '',
  action: '',
  q: '',
  limit: 30,
  days: 7,
})

const categoryOptions = [
  { label: '全部分类', value: '' },
  { label: '认证', value: 'auth' },
  { label: '授权', value: 'oauth2' },
  { label: '后台', value: 'admin' },
  { label: '系统', value: 'system' },
]

const limitOptions = [
  { label: '20 条', value: 20 },
  { label: '30 条', value: 30 },
  { label: '50 条', value: 50 },
  { label: '100 条', value: 100 },
]

const daysOptions = [
  { label: '7 天', value: 7 },
  { label: '14 天', value: 14 },
  { label: '30 天', value: 30 },
]

onMounted(async () => {
  await Promise.all([loadLogs(), loadSummary()])
})

async function loadLogs() {
  loading.value = true
  try {
    const query: { q?: string; action?: string; category?: AuditCategory; limit?: number } = {}
    if (filters.value.q) query.q = filters.value.q
    if (filters.value.action) query.action = filters.value.action
    if (filters.value.category) query.category = filters.value.category
    query.limit = filters.value.limit
    logs.value = await adminApi.listAuditLogs(query)
  } catch { /* silent */ }
  finally { loading.value = false }
}

async function loadSummary() {
  try {
    summary.value = await adminApi.getAuditSummary(filters.value.days)
  } catch { /* silent */ }
}

async function search() {
  await Promise.all([loadLogs(), loadSummary()])
}

function categoryTone(category: AuditCategory): 'info' | 'warning' | 'success' | 'danger' {
  const map: Record<AuditCategory, 'info' | 'warning' | 'success' | 'danger'> = {
    auth: 'info',
    oauth2: 'warning',
    admin: 'success',
    system: 'neutral' as 'info',
  }
  return map[category] || 'info'
}

function statusTagForCategory(category: AuditCategory): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  const map: Record<AuditCategory, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
    auth: 'info',
    oauth2: 'warning',
    admin: 'success',
    system: 'neutral',
  }
  return map[category] || 'neutral'
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      eyebrow="可审计"
      title="审计日志"
      description="保留机器可读动作 code，同时提供面向业务的中文解释。metadata 使用等宽格式呈现并支持横向滚动。"
    >
      <template #actions>
        <t-button variant="outline" @click="search">刷新</t-button>
        <t-button theme="primary" @click="search">查询</t-button>
      </template>
    </PageHeader>

    <div class="metric-grid">
      <MetricCard
        label="近 {{ filters.days }} 天总日志"
        :value="summary ? formatCount(summary.total) : '—'"
        caption="认证、授权、后台与系统事件"
        trend="查询中"
        tone="info"
      />
      <MetricCard
        label="24h 事件"
        :value="summary ? formatCount(summary.last24Hours) : '—'"
        caption="今日累计写入事件数"
        trend="稳定"
        tone="success"
      />
      <MetricCard
        label="身份类事件"
        :value="summary ? formatCount(summary.identityEvents) : '—'"
        caption="登录、注册、重置密码、绑定"
        trend="高频"
        tone="warning"
      />
      <MetricCard
        label="活跃操作者"
        :value="summary ? formatCount(summary.uniqueActors) : '—'"
        caption="近 24h 触发过动作的主体"
        trend="可追溯"
        tone="neutral"
      />
    </div>

    <section class="panel-card p-6">
      <div class="grid gap-4 xl:grid-cols-[1fr,1fr,1fr,auto,auto]">
        <t-select
          v-model="filters.category"
          size="large"
          :options="categoryOptions"
        />
        <t-input v-model="filters.action" size="large" placeholder="动作关键字" @keyup.enter="search" />
        <t-input v-model="filters.q" size="large" placeholder="邮箱 / 应用 / IP 关键字" @keyup.enter="search" />
        <t-select
          v-model="filters.limit"
          size="large"
          :options="limitOptions"
        />
        <t-select
          v-model="filters.days"
          size="large"
          :options="daysOptions"
        />
      </div>

      <div class="mt-5 grid gap-6 xl:grid-cols-[1.55fr,0.8fr]">
        <div class="space-y-4">
          <div v-if="logs.length === 0 && !loading" class="panel-muted p-5 text-center">
            <p class="text-sm text-[var(--text-muted)]">暂无匹配的审计日志</p>
          </div>

          <article
            v-for="log in logs"
            :key="log.id"
            class="panel-muted p-5"
          >
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <StatusTag :tone="statusTagForCategory(log.category)" :label="formatAuditCategory(log.category)" />
                  <span class="font-mono text-sm text-[var(--text-primary)]">{{ formatAuditAction(log.action) }}</span>
                </div>
                <p class="mt-3 text-sm text-[var(--text-secondary)]">
                  {{ log.actorEmail || log.actorName || log.actorId || 'system' }}
                  <span v-if="log.applicationId"> · {{ log.applicationId }}</span>
                  <span v-if="log.targetId"> · {{ log.targetId }}</span>
                </p>
              </div>
              <div class="text-right">
                <p class="font-mono text-xs text-[var(--text-muted)]">{{ log.createdAt }}</p>
                <p v-if="log.ip" class="mt-2 text-xs text-[var(--text-muted)]">{{ log.ip }}</p>
              </div>
            </div>

            <pre v-if="log.metadata" class="metadata-pre mt-4">{{ JSON.stringify(log.metadata, null, 2) }}</pre>
          </article>
        </div>

        <div class="space-y-5">
          <div class="panel-muted p-5">
            <p class="eyebrow">侧栏摘要</p>
            <div class="mt-4 space-y-3">
              <div
                v-for="item in summary?.topActions?.slice(0, 3) || []"
                :key="item.action"
                class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4"
              >
                <div class="flex items-center justify-between gap-3">
                  <p class="text-sm text-[var(--text-muted)]">高频操作</p>
                  <StatusTag :tone="statusTagForCategory(item.category)" :label="formatCount(item.count)" />
                </div>
                <p class="mt-3 break-all font-mono text-sm text-[var(--text-primary)]">{{ formatAuditAction(item.action) }}</p>
              </div>

              <div v-if="!summary?.topActions?.length" class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] px-4 py-4">
                <p class="text-sm text-[var(--text-muted)]">暂无摘要数据</p>
              </div>
            </div>
          </div>

          <div class="panel-muted p-5">
            <p class="eyebrow">设计约束</p>
            <div class="timeline-list mt-4">
              <div class="timeline-item">
                <p class="text-sm font-semibold text-[var(--text-primary)]">颜色只用于分类和风险提示</p>
                <p class="mt-1 text-sm leading-6 text-[var(--text-muted)]">避免将颜色当成装饰，提高审计可读性。</p>
              </div>
              <div class="timeline-item">
                <p class="text-sm font-semibold text-[var(--text-primary)]">metadata 不撑破布局</p>
                <p class="mt-1 text-sm leading-6 text-[var(--text-muted)]">长 JSON 统一放进等宽 `pre` 容器并允许横向滚动。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
