<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusTag from '../components/StatusTag.vue'

const route = useRoute()
const router = useRouter()
const error = ref('')
const statusText = ref('处理中...')
const processingComplete = ref(false)

const statusTone = computed(() => {
  if (error.value) return 'danger'
  if (processingComplete.value) return 'success'
  return 'processing'
})

onMounted(() => {
  const errParam = route.query.error as string | undefined
  const code = route.query.code as string | undefined

  if (errParam) {
    error.value = decodeURIComponent(errParam)
    statusText.value = '授权未完成，服务端返回了错误信息'
    processingComplete.value = true
  } else if (code) {
    statusText.value = '授权码已生成，业务系统将通过后端交换 Token...'
    processingComplete.value = true
  } else {
    statusText.value = '正在等待授权回调，请确认 redirect_uri 配置正确'
  }
})
</script>

<template>
  <section class="panel-card callback-card lumina-callback">
    <!-- Status icon area -->
    <div class="callback-status-icon" :class="`callback-status-${statusTone}`">
      <div v-if="!processingComplete && !error" class="callback-spinner">
        <div class="spinner-ring"></div>
      </div>
      <div v-else-if="error" class="callback-icon-text">!</div>
      <div v-else class="callback-icon-text">✓</div>
    </div>

    <div class="text-center mt-5">
      <p class="eyebrow">OAuth 回调</p>
      <h1 class="callback-title">授权结果处理状态</h1>
      <p class="callback-desc">{{ statusText }}</p>
    </div>

    <!-- Processing dots animation -->
    <div v-if="!processingComplete && !error" class="callback-dots">
      <span class="dot dot-1"></span>
      <span class="dot dot-2"></span>
      <span class="dot dot-3"></span>
    </div>

    <div class="mt-6 space-y-4">
      <div class="panel-muted p-4" style="border-radius: 1rem;">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">1. 接收业务系统回调上下文</p>
          <StatusTag :tone="route.query.code ? 'success' : 'warning'" :label="route.query.code ? '已接收' : '等待中'" />
        </div>
        <p class="mt-2 font-mono text-xs text-[var(--text-secondary)]">
          client_id={{ route.query.client_id || '—' }}
        </p>
      </div>

      <div v-if="error" class="rounded-2xl border border-[rgba(244,63,94,0.15)] bg-[rgba(244,63,94,0.08)] p-4">
        <p class="text-sm font-semibold text-[var(--danger)]">错误详情</p>
        <pre class="metadata-pre mt-2">{{ error }}</pre>
      </div>

      <div v-else class="panel-muted p-4" style="border-radius: 1rem;">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">2. 准备向业务系统返回授权码</p>
          <StatusTag tone="info" label="待后端接管" />
        </div>
        <p class="mt-2 text-sm leading-6 text-[var(--text-muted)]">后端完成 code 与 state 校验后将重定向回 redirect_uri。</p>
      </div>
    </div>

    <div class="action-row mt-6 justify-center">
      <t-button theme="primary" class="lumina-primary-btn" @click="router.push('/user/account')">进入用户中心</t-button>
      <t-button variant="outline" class="lumina-outline-btn" @click="router.push('/login')">返回登录页</t-button>
    </div>

    <p class="mt-6 text-center text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-faint)]">
      <span class="inline-flex items-center gap-1.5">
        <t-icon name="swap" size="12px" />
        Identity Provider Callback Handler
      </span>
    </p>
  </section>
</template>

<style scoped>
.lumina-callback {
  max-width: 520px;
  margin: 0 auto;
  padding: 2.5rem;
  border-radius: 2.5rem;
  animation: scaleIn 0.5s ease-out;
}

.callback-status-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto;
  border-radius: 1.5rem;
  display: grid;
  place-items: center;
  transition: all 300ms ease;
}

.callback-status-processing {
  background: var(--surface-muted);
  border: 1px solid var(--border-primary);
}

.callback-status-success {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
  box-shadow: 0 20px 40px -20px rgba(16, 185, 129, 0.2);
}

.callback-status-danger {
  background: rgba(244, 63, 94, 0.08);
  border: 1px solid rgba(244, 63, 94, 0.2);
  box-shadow: 0 20px 40px -20px rgba(244, 63, 94, 0.2);
}

.callback-icon-text {
  font-size: 28px;
  font-weight: 900;
  color: inherit;
}

.callback-status-success .callback-icon-text { color: var(--success); }
.callback-status-danger .callback-icon-text { color: var(--danger); }

.callback-spinner {
  width: 32px;
  height: 32px;
}

.spinner-ring {
  width: 100%;
  height: 100%;
  border: 3px solid var(--border-primary);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.callback-title {
  margin-top: 8px;
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.callback-desc {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

/* Bouncing dots */
.callback-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: dotBounce 1.4s ease-in-out infinite;
}
.dot-2 { animation-delay: 0.2s; }
.dot-3 { animation-delay: 0.4s; }

@keyframes dotBounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-8px); opacity: 1; }
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
:deep(.lumina-primary-btn:active) { transform: scale(0.95) !important; }

:deep(.lumina-outline-btn) {
  border-radius: 1rem !important;
  font-weight: 700 !important;
}
:deep(.lumina-outline-btn:active) { transform: scale(0.95) !important; }
</style>
