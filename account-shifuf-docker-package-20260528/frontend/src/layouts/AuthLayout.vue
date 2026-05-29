<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTheme } from '../composables/useTheme'
import Icon from '../components/Icon.vue'

const router = useRouter()
const authStore = useAuthStore()
const { resolvedTheme, setTheme } = useTheme()

const userCenterPath = computed(() => (
  authStore.user?.role === 'admin' ? '/user/overview' : '/user/account'
))

function goHome(tab?: 'oauth' | 'contact') {
  void router.push(tab ? { path: '/', query: { tab } } : '/')
}

function toggleTheme() {
  setTheme(resolvedTheme.value === 'dark' ? 'light' : 'dark')
}
</script>

<template>
  <div class="auth-page">
    <header class="auth-portal-topbar">
      <button class="auth-portal-brand" type="button" @click="goHome()">
        <span><Icon name="secured" size="18px" /></span>
        <strong>一证通行</strong>
      </button>

      <nav class="auth-portal-nav" aria-label="认证页导航">
        <button type="button" @click="goHome()">首页</button>
        <button type="button" @click="goHome('oauth')">OAuth文档</button>
        <button type="button" @click="goHome('contact')">联系我们</button>
      </nav>

      <div class="auth-portal-actions">
        <button class="auth-icon-action" type="button" aria-label="切换主题" @click="toggleTheme">
          <Icon :name="resolvedTheme === 'dark' ? 'sunny' : 'moon'" size="18px" />
        </button>
        <button class="auth-text-action" type="button" @click="router.push(authStore.isAuthenticated ? userCenterPath : '/login')">
          {{ authStore.isAuthenticated ? '用户中心' : '登录' }}
        </button>
      </div>
    </header>

    <div class="auth-shell">
      <router-view />
    </div>
  </div>
</template>
