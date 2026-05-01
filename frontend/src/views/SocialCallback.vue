<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import StatusTag from '../components/StatusTag.vue'

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
  const accessToken = route.query.access_token as string | undefined
  const user = route.query.user as string | undefined

  if (err) {
    error.value = decodeURIComponent(err)
    processing.value = false
    return
  }

  // Login mode: backend has already created/returned user, apply tokens from URL
  if (accessToken && user) {
    try {
      authStore.applySession({
        access_token: accessToken,
        refresh_token: (route.query.refresh_token as string) || '',
        token_type: 'Bearer',
        expires_in: Number(route.query.expires_in || '3600'),
        scope: (route.query.scope as string) || '',
        user: JSON.parse(decodeURIComponent(user)),
      })
      MessagePlugin.success('登录成功')
      processing.value = false
      return
    } catch {
      error.value = '解析用户信息失败'
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
    router.push('/console/account')
  } catch (e: unknown) {
    MessagePlugin.error((e as { message?: string })?.message || '绑定失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="panel-card callback-card">
    <div class="page-header">
      <div>
        <p class="eyebrow">第三方回调</p>
        <h1 class="page-title">社交登录处理状态</h1>
        <p class="page-copy">处理第三方授权返回结果，进行账号登录或绑定。</p>
      </div>
      <StatusTag
        :tone="error ? 'danger' : needsBinding ? 'warning' : processing ? 'info' : 'success'"
        :label="error ? '失败' : needsBinding ? '待绑定' : processing ? '处理中' : '完成'"
      />
    </div>

    <div class="mt-6 space-y-4">
      <div v-if="processing" class="panel-muted p-4">
        <p class="text-sm text-[var(--text-muted)]">正在处理第三方授权回调...</p>
      </div>

      <div v-else-if="error" class="rounded-2xl border border-[rgba(220,38,38,0.15)] bg-[rgba(239,68,68,0.08)] p-4">
        <p class="text-sm font-semibold text-[var(--danger)]">错误详情</p>
        <pre class="metadata-pre mt-2">{{ error }}</pre>
      </div>

      <!-- Bind existing account form (publicApiEnabled = false) -->
      <div v-else-if="needsBinding" class="space-y-4">
        <div class="rounded-2xl border border-[rgba(245,158,11,0.15)] bg-[rgba(245,158,11,0.08)] p-4">
          <p class="text-sm font-semibold text-[var(--warning)]">该第三方账号尚未绑定任何用户</p>
          <p class="mt-1 text-sm leading-6 text-[var(--text-muted)]">管理员已关闭开放注册，请输入已有账号凭据完成绑定。</p>
        </div>

        <div class="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-muted)] p-5 space-y-4">
          <p class="text-sm font-semibold text-[var(--text-primary)]">绑定已有账号</p>
          <div v-if="!showBindForm">
            <t-button theme="primary" @click="showBindForm = true">绑定已有账号</t-button>
          </div>
          <div v-else class="space-y-4">
            <t-input v-model="bindForm.username" size="large" placeholder="用户名或邮箱" />
            <t-input v-model="bindForm.password" type="password" size="large" placeholder="密码" @keyup.enter="handleBindExisting" />
            <div class="action-row">
              <t-button variant="outline" @click="showBindForm = false">取消</t-button>
              <t-button theme="primary" :loading="submitting" @click="handleBindExisting">确认绑定</t-button>
            </div>
          </div>
        </div>
      </div>

      <!-- Bind mode success -->
      <div v-else-if="route.query.mode === 'bind'" class="panel-muted p-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">已成功绑定 {{ route.query.provider || '第三方' }} 账号</p>
          <StatusTag tone="success" label="绑定成功" />
        </div>
      </div>

      <!-- Logged in -->
      <div v-else-if="authStore.isAuthenticated" class="panel-muted p-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">已登录</p>
          <StatusTag tone="success" label="成功" />
        </div>
      </div>

      <div v-else class="panel-muted p-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-[var(--text-primary)]">已处理完成</p>
          <StatusTag tone="success" label="成功" />
        </div>
      </div>
    </div>

    <div class="action-row mt-6">
      <t-button theme="primary" @click="$router.push(authStore.isAuthenticated ? '/console/overview' : '/login')">
        {{ authStore.isAuthenticated ? '进入控制台' : '返回登录页' }}
      </t-button>
    </div>
  </section>
</template>
