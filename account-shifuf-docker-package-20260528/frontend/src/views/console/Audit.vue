<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { MessagePlugin, DialogPlugin } from '../../utils/ui'
import { adminApi } from '../../api/admin'
import type { AuditLogItem, AuditSummary, AuditCategory } from '../../types/api'
import { formatAuditAction, formatAuditCategory, formatCount, formatDateTime } from '../../utils/console'
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

const clearOptions = [
  { label: '清理 30 天前', value: 30 },
  { label: '清理 90 天前', value: 90 },
  { label: '清理全部', value: -1 },
]

const clearOlderThanDays = ref(30)

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

async function clearLogs() {
  const label = clearOlderThanDays.value < 0 ? '全部审计日志' : `${clearOlderThanDays.value} 天前的审计日志`
  const dialog = DialogPlugin.confirm({
    header: '清理审计日志',
    body: `确定要清理${label}吗？该操作不可撤销。`,
    confirmBtn: '确认清理',
    cancelBtn: '取消',
    theme: 'danger',
    onConfirm: async () => {
      try {
        const result = await adminApi.clearAuditLogs(clearOlderThanDays.value < 0 ? undefined : clearOlderThanDays.value)
        MessagePlugin.success(`已清理 ${formatCount(result.deletedCount)} 条日志`)
        await search()
      } catch (e: unknown) { MessagePlugin.error((e as { message?: string })?.message || '清理失败') }
      dialog.hide()
    },
  })
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
      title="审计日志"
    >
      <template #actions>
        <NButton @click="search">刷新</NButton>
        <NButton type="primary" @click="search">查询</NButton>
      </template>
    </PageHeader>

    <div class="metric-grid">
      <MetricCard
        :label="`近 ${filters.days} 天总日志`"
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
        <NSelect
          v-model:value="filters.category"
          size="large"
          :options="categoryOptions"
        />
        <NInput v-model:value="filters.action" size="large" placeholder="动作关键字" @keyup.enter="search" />
        <NInput v-model:value="filters.q" size="large" placeholder="邮箱 / 应用 / IP 关键字" @keyup.enter="search" />
        <NSelect
          v-model:value="filters.limit"
          size="large"
          :options="limitOptions"
        />
        <NSelect
          v-model:value="filters.days"
          size="large"
          :options="daysOptions"
        />
      </div>

      <div class="mt-4 flex flex-wrap items-center justify-end gap-3">
        <NSelect
          v-model:value="clearOlderThanDays"
          class="w-44"
          :options="clearOptions"
        />
        <NButton type="error" ghost @click="clearLogs">清理日志</NButton>
      </div>

      <div class="mt-5">
        <div class="table-shell">
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>动作</th>
                  <th>分类</th>
                  <th>操作者</th>
                  <th>目标</th>
                  <th>IP</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in logs" :key="log.id">
                  <td>
                    <span class="font-mono text-sm text-[var(--text-primary)]">{{ formatAuditAction(log.action) }}</span>
                  </td>
                  <td>
                    <StatusTag :tone="statusTagForCategory(log.category)" :label="formatAuditCategory(log.category)" />
                  </td>
                  <td>
                    <span class="text-sm text-[var(--text-secondary)]">{{ log.actorEmail || log.actorName || log.actorId || 'system' }}</span>
                  </td>
                  <td>
                    <span class="text-sm text-[var(--text-muted)]">{{ log.targetId || log.applicationId || '—' }}</span>
                  </td>
                  <td>
                    <span class="font-mono text-xs text-[var(--text-muted)]">{{ log.ip || '—' }}</span>
                  </td>
                  <td>
                    <span class="text-xs text-[var(--text-muted)]">{{ formatDateTime(log.createdAt) }}</span>
                  </td>
                </tr>
                <tr v-if="logs.length === 0 && !loading">
                  <td colspan="6" class="text-center py-8 text-[var(--text-muted)]">暂无匹配的审计日志</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Summary -->
        <div class="mt-6 grid gap-4 lg:grid-cols-3">
          <div
            v-for="item in summary?.topActions?.slice(0, 3) || []"
            :key="item.action"
            class="panel-muted p-4"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="font-mono text-sm text-[var(--text-primary)]">{{ formatAuditAction(item.action) }}</span>
              <StatusTag :tone="statusTagForCategory(item.category)" :label="formatCount(item.count)" />
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
