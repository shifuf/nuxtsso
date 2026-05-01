<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import StatusTag from '../components/StatusTag.vue'

const route = useRoute()
const error = ref('')
const statusText = ref('处理中...')

onMounted(() => {
  const errParam = route.query.error as string | undefined
  const code = route.query.code as string | undefined
  const state = route.query.state as string | undefined

  if (errParam) {
    error.value = decodeURIComponent(errParam)
    statusText.value = '授权失败 — 后端返回了错误信息'
  } else if (code) {
    statusText.value = '授权码已生成，业务系统将通过后端交换 Token...'
  } else {
    statusText.value = '等待中 — 如果长时间未响应，请检查 redirect_uri 配置'
  }

  // If this is a backend-completed flow, redirect happens server-side.
  // Frontend only displays intermediate states.
})
</script>

<template>
  <section class="panel-card callback-card">
    <div class="page-header">
      <div>
        <p class="eyebrow">OAuth 回调</p>
        <h1 class="page-title">授权结果处理状态</h1>
        <p class="page-copy">{{ statusText }}</p>
      </div>
      <StatusTag :tone="error ? 'danger' : 'success'" :label="error ? '失败' : '处理中'" />
    </div>

    <div class="mt-6 space-y-4">
      <div class="panel-muted p-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">1. 接收业务系统回调上下文</p>
          <StatusTag :tone="route.query.code ? 'success' : 'warning'" :label="route.query.code ? '已接收' : '等待中'" />
        </div>
        <p class="mt-2 font-mono text-sm text-[var(--text-secondary)]">
          client_id={{ route.query.client_id || '—' }}
        </p>
      </div>

      <div v-if="error" class="rounded-2xl border border-[rgba(220,38,38,0.15)] bg-[rgba(239,68,68,0.08)] p-4">
        <p class="text-sm font-semibold text-[var(--danger)]">错误详情</p>
        <pre class="metadata-pre mt-2">{{ error }}</pre>
      </div>

      <div v-else class="panel-muted p-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">2. 准备向业务系统返回授权码</p>
          <StatusTag tone="info" label="待后端接管" />
        </div>
        <p class="mt-2 text-sm leading-6 text-[var(--text-muted)]">后端完成 code 与 state 校验后将重定向回 redirect_uri。</p>
      </div>
    </div>

    <div class="action-row mt-6">
      <t-button theme="primary" @click="$router.push('/console/overview')">进入控制台</t-button>
      <t-button variant="outline" @click="$router.push('/login')">返回登录页</t-button>
    </div>
  </section>
</template>
