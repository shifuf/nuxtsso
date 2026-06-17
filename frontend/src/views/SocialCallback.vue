<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput } from 'naive-ui'
import { MessagePlugin } from '../utils/ui'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import StatusTag from '../components/StatusTag.vue'
import Icon from '../components/Icon.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const processing = ref(true)
const error = ref('')
const needsBinding = ref(false)
const bindStateToken = ref('')
const bindForm = reactive({ username: '', password: '' })
const showBindForm = ref(false)
const submitting = ref(false)

onMounted(async () => {
  const err = route.query.error as string | undefined
  const state = route.query.state as string | undefined
  const mode = route.query.mode as string | undefined
  const ticket = route.query.ticket as string | undefined

  if (err) {
    error.value = decodeURIComponent(err)
    processing.value = false
    return
  }

  if (ticket) {
    try {
      const result = await authApi.redeemSocialLoginTicket(ticket)
      authStore.applySession(result)
      await router.replace({ path: route.path, query: {} })
      MessagePlugin.success('登录成功')
      processing.value = false
      return
    } catch (e: unknown) {
      error.value = (e as { message?: string })?.message || '登录凭证无效或已过期'
      processing.value = false
      return
    }
  }

  // Bind mode success
  if (mode === 'bind') {
    processing.value = false
    return
  }

  // need_bind mode: publicApiEnabled is off, user must bind to existing account
  if (mode === 'need_bind' && state) {
    bindStateToken.value = state
    needsBinding.value = true
    processing.value = false
    return
  }

  // State param consumed by backend — show complete
  if (state) {
    processing.value = false
    return
  }

  processing.value = false
})

async function handleBindExisting() {
  if (!bindForm.username || !bindForm.password) {
    return MessagePlugin.warning('请输入用户名和密码')
  }
  submitting.value = true
  try {
    const result = await authApi.bindExistingSocial(
      bindStateToken.value,
      bindForm.username,
      bindForm.password,
    )
    authStore.applySession(result)
    MessagePlugin.success('第三方账号已绑定到已有账号')
    router.push('/user/account')
  } catch (e: unknown) {
    MessagePlugin.error((e as { message?: string })?.message || '绑定失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="panel-card callback-card lumina-callback">
    <!-- Status icon area -->
    <div class="callback-status-icon" :class="`callback-status-${error ? 'danger' : needsBinding ? 'warning' : processing ? 'processing' : 'success'}`">
      <div v-if="processing" class="callback-spinner">
        <div class="spinner-ring"></div>
      </div>
      <div v-else-if="error" class="callback-icon-text">!</div>
      <div v-else-if="needsBinding" class="callback-icon-text">?</div>
      <div v-else class="callback-icon-text">✓</div>
    </div>

    <div class="text-center mt-5">
      <p class="eyebrow">第三方回调</p>
      <h1 class="callback-title">社交登录处理状态</h1>
      <p class="callback-desc">处理第三方授权返回结果，进行账号登录或绑定。</p>
    </div>

    <!-- Processing dots animation -->
    <div v-if="processing" class="callback-dots">
      <span class="dot dot-1"></span>
      <span class="dot dot-2"></span>
      <span class="dot dot-3"></span>
    </div>

    <div class="mt-6 space-y-4">
      <div v-if="processing" class="panel-muted p-4" style="border-radius: 1rem;">
        <p class="text-sm text-[var(--text-muted)]">正在处理第三方授权回调...</p>
      </div>

      <div v-else-if="error" class="rounded-2xl border border-[rgba(244,63,94,0.15)] bg-[rgba(244,63,94,0.08)] p-4">
        <p class="text-sm font-semibold text-[var(--danger)]">错误详情</p>
        <pre class="metadata-pre mt-2">{{ error }}</pre>
      </div>

      <!-- Bind existing account form -->
      <div v-else-if="needsBinding" class="space-y-4">
        <div class="rounded-2xl border border-[rgba(245,158,11,0.15)] bg-[rgba(245,158,11,0.08)] p-4">
          <p class="text-sm font-semibold text-[var(--warning)]">该第三方账号尚未绑定任何用户</p>
          <p class="mt-1 text-sm leading-6 text-[var(--text-muted)]">管理员已关闭开放注册，请输入已有账号凭据完成绑定。</p>
        </div>

        <div class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-muted)] p-5 space-y-4">
          <p class="text-sm font-semibold text-[var(--text-primary)]">绑定已有账号</p>
          <div v-if="!showBindForm">
            <NButton type="primary" class="lumina-primary-btn" @click="showBindForm = true">绑定已有账号</NButton>
          </div>
          <div v-else class="space-y-4">
            <NInput v-model:value="bindForm.username" size="large" placeholder="用户名或邮箱" />
            <NInput v-model:value="bindForm.password" type="password" size="large" placeholder="密码" @keyup.enter="handleBindExisting" />
            <div class="action-row">
              <NButton class="lumina-outline-btn" @click="showBindForm = false">取消</NButton>
              <NButton type="primary" class="lumina-primary-btn" :loading="submitting" @click="handleBindExisting">确认绑定</NButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Bind mode success -->
      <div v-else-if="route.query.mode === 'bind'" class="panel-muted p-4" style="border-radius: 1rem;">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">已成功绑定 {{ route.query.provider || '第三方' }} 账号</p>
          <StatusTag tone="success" label="绑定成功" />
        </div>
      </div>

      <!-- Logged in -->
      <div v-else-if="authStore.isAuthenticated" class="panel-muted p-4" style="border-radius: 1rem;">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">已登录</p>
          <StatusTag tone="success" label="成功" />
        </div>
      </div>

      <div v-else class="panel-muted p-4" style="border-radius: 1rem;">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">已处理完成</p>
          <StatusTag tone="success" label="成功" />
        </div>
      </div>
    </div>

    <div class="action-row mt-6 justify-center">
      <NButton type="primary" class="lumina-primary-btn" @click="router.push(authStore.isAuthenticated ? '/user/account' : '/login')">
        {{ authStore.isAuthenticated ? '进入用户中心' : '返回登录页' }}
      </NButton>
    </div>

    <p class="mt-6 text-center text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-faint)]">
      <span class="inline-flex items-center gap-1.5">
        <Icon name="swap" size="12px" />
        Social Identity Provider Callback
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

.callback-status-warning {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
  box-shadow: 0 20px 40px -20px rgba(245, 158, 11, 0.2);
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
.callback-status-warning .callback-icon-text { color: var(--warning); }
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
