<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import BrandMark from '../components/BrandMark.vue'
import ThemeSwitch from '../components/ThemeSwitch.vue'

const router = useRouter()
const authStore = useAuthStore()
const currentStep = ref(0)
const submitting = ref(false)
const alreadyInitialized = ref(false)
const steps = ['服务配置', '创建管理员']

const formData = reactive({
  serviceName: '一证通行',
  issuer: location.origin,
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
})

onMounted(async () => {
  try {
    const status = await authApi.getSetupStatus()
    if (status.initialized) {
      alreadyInitialized.value = true
    }
  } catch { /* backend may not be ready yet */ }
})

const currentSummary = computed(() => {
  if (currentStep.value === 0) {
    return [
      { label: '服务名称', value: formData.serviceName },
      { label: 'OIDC Issuer', value: formData.issuer },
    ]
  }
  return [
    { label: '用户名', value: formData.username },
    { label: '管理员邮箱', value: formData.email },
    { label: '密码策略', value: formData.password ? '已填写' : '未填写' },
  ]
})

async function proceed() {
  if (currentStep.value === 0) {
    if (!formData.serviceName) return MessagePlugin.warning('请输入服务名称')
    currentStep.value = 1
    return
  }

  if (!formData.username || !formData.email || !formData.password) {
    return MessagePlugin.warning('请填写所有必填项')
  }
  if (formData.password !== formData.confirmPassword) {
    return MessagePlugin.warning('两次密码输入不一致')
  }

  submitting.value = true
  try {
    const res = await authApi.runSetup({
      username: formData.username,
      email: formData.email,
      password: formData.password,
      serviceName: formData.serviceName,
      issuer: formData.issuer,
    })
    authStore.applySession(res)
    MessagePlugin.success('初始化完成')
    router.push('/user/overview')
  } catch (e: unknown) {
    MessagePlugin.error((e as { message?: string })?.message || '初始化失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="setup-shell">
    <div class="auth-frame">
      <div class="auth-topbar">
        <BrandMark title="一证通行" subtitle="首次安装向导" />
        <ThemeSwitch />
      </div>

      <div v-if="alreadyInitialized" class="panel-card callback-card">
        <div class="text-center">
          <div class="grid h-16 w-16 mx-auto place-items-center rounded-2xl bg-[var(--accent-soft)]">
            <t-icon name="check-circle-filled" size="32px" class="text-[var(--accent)]" />
          </div>
          <h2 class="mt-4 text-xl font-semibold text-[var(--text-primary)]">系统已完成初始化</h2>
          <p class="mt-2 text-sm text-[var(--text-muted)]">如需重新初始化，请清空数据库后重试。</p>
          <t-button theme="primary" class="mt-6" @click="router.push('/login')">前往登录</t-button>
        </div>
      </div>

      <div v-else class="auth-grid">
        <section class="panel-contrast auth-card">
          <p class="eyebrow !text-slate-400">部署目标</p>
          <h1 class="mt-3 text-4xl font-display text-white">让系统在两步内可用。</h1>
          <p class="mt-4 text-sm leading-7 text-slate-300">初始化只需要完成服务名称、OIDC Issuer 与首个超级管理员创建，成功后直接进入用户中心。</p>
          <div class="stack-list mt-8">
            <div class="panel-muted stack-item !bg-white/6 !border-white/10">
              <div>
                <p class="text-xs uppercase tracking-[0.14em] text-slate-400">上线准备度</p>
                <p class="mt-2 text-sm font-semibold text-slate-100">OAuth2 / OIDC / 统一登录 / 用户中心</p>
              </div>
              <span class="tag tag-success">P0</span>
            </div>
            <div class="panel-muted stack-item !bg-white/6 !border-white/10">
              <div>
                <p class="text-xs uppercase tracking-[0.14em] text-slate-400">安全基线</p>
                <p class="mt-2 text-sm font-semibold text-slate-100">邮箱验证、审计日志、会话控制、备份</p>
              </div>
              <span class="tag tag-warning">后续配置</span>
            </div>
          </div>
        </section>

        <section class="panel-card auth-card">
          <div class="page-header">
            <div>
              <p class="eyebrow">系统初始化</p>
              <h2 class="page-title">完成基础配置</h2>
              <p class="page-copy">先配置服务，再创建第一个超级管理员。</p>
            </div>
            <span class="tag tag-info">步骤 {{ currentStep + 1 }} / {{ steps.length }}</span>
          </div>

          <div class="mt-6">
            <t-steps :current="currentStep" theme="dot" layout="horizontal">
              <t-step-item v-for="step in steps" :key="step" :title="step" />
            </t-steps>
          </div>

          <div class="section-divider mt-6 pt-6">
            <div v-if="currentStep === 0" class="space-y-5">
              <t-form :data="formData" label-align="top" class="space-y-4">
                <t-form-item label="服务名称">
                  <t-input v-model="formData.serviceName" size="large" placeholder="展示在登录页和用户中心的名称" />
                </t-form-item>
                <t-form-item label="OIDC Issuer">
                  <t-input v-model="formData.issuer" size="large" placeholder="留空时可回退到当前域名" />
                </t-form-item>
              </t-form>
              <div class="panel-muted p-4">
                <p class="eyebrow">说明</p>
                <p class="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Issuer 是 OIDC Discovery 的根地址，影响 Token 和 UserInfo 端点展示。</p>
              </div>
            </div>

            <div v-else class="space-y-5">
              <t-form :data="formData" label-align="top" class="space-y-4">
                <div class="grid gap-4 md:grid-cols-2">
                  <t-form-item label="管理员用户名"><t-input v-model="formData.username" size="large" /></t-form-item>
                  <t-form-item label="管理员邮箱"><t-input v-model="formData.email" size="large" /></t-form-item>
                </div>
                <div class="grid gap-4 md:grid-cols-2">
                  <t-form-item label="密码"><t-input v-model="formData.password" type="password" size="large" /></t-form-item>
                  <t-form-item label="确认密码"><t-input v-model="formData.confirmPassword" type="password" size="large" /></t-form-item>
                </div>
              </t-form>
            </div>
          </div>

          <div class="section-divider mt-6 pt-6">
            <p class="eyebrow">当前步骤摘要</p>
            <div class="mt-4 space-y-3">
              <div v-for="item in currentSummary" :key="item.label" class="panel-muted flex items-start justify-between gap-4 px-4 py-3">
                <span class="text-sm text-[var(--text-muted)]">{{ item.label }}</span>
                <span class="max-w-[62%] break-all text-right font-mono text-sm text-[var(--text-primary)]">{{ item.value }}</span>
              </div>
            </div>
          </div>

          <div class="action-row mt-6">
            <t-button v-if="currentStep > 0" variant="outline" size="large" class="!px-6" @click="currentStep -= 1">上一步</t-button>
            <t-button theme="primary" size="large" :loading="submitting" class="!px-6" @click="proceed">
              {{ currentStep === steps.length - 1 ? '初始化并进入首页' : '下一步' }}
            </t-button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
