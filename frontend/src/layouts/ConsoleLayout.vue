<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DialogPlugin, MessagePlugin } from '../utils/ui'
import { useAuthStore } from '../stores/auth'
import { authApi } from '../api/auth'
import { consoleNavItems } from '../utils/console'
import { useSidebarCollapsed } from '../composables/useSidebarCollapsed'
import BrandMark from '../components/BrandMark.vue'
import ThemeSwitch from '../components/ThemeSwitch.vue'
import Icon from '../components/Icon.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const bootstrapping = ref(true)
const mobileMenuOpen = ref(false)
const { collapsed, toggleCollapsed, setCollapsed } = useSidebarCollapsed()

const isAdmin = computed(() => authStore.user?.role === 'admin')
const visibleNavItems = computed(() =>
  consoleNavItems.filter((item) => !item.adminOnly || isAdmin.value),
)

const userDisplayName = computed(() => {
  const u = authStore.user?.username?.trim()
  if (u) return u
  return authStore.user?.email?.split('@')[0] ?? '管理员'
})

function ensureRouteAccess() {
  if (!bootstrapping.value && route.meta.requiresAdmin && !isAdmin.value) {
    void router.replace('/user/account')
  }
}

async function bootstrapSession() {
  try {
    await authStore.refreshSession()
  } catch {
    MessagePlugin.error('会话已失效')
    authStore.clearSession()
    await router.replace('/login')
  } finally {
    bootstrapping.value = false
    ensureRouteAccess()
  }
}

function logout() {
  const dialog = DialogPlugin.confirm({
    header: '退出登录',
    body: '确定要退出当前账号吗？退出后需要重新登录才能进入用户中心。',
    confirmBtn: '确认退出',
    cancelBtn: '取消',
    theme: 'warning',
    onConfirm: async () => {
      try {
        await authApi.logout()
      } catch {
        // Local cleanup still prevents stale UI if the server session already expired.
      } finally {
        authStore.clearSession()
        await router.push('/login')
        dialog.hide()
      }
    },
  })
}

watch(() => route.path, () => { mobileMenuOpen.value = false })
watch(() => authStore.user?.role, ensureRouteAccess)
onMounted(() => { void bootstrapSession() })
</script>

<template>
  <div class="app-shell flex min-h-screen">
    <!-- Mobile overlay -->
    <div
      v-if="mobileMenuOpen"
      class="fixed inset-0 z-40 bg-slate-950/60 md:hidden"
      @click="mobileMenuOpen = false"
    />

    <!-- Sidebar -->
    <aside :class="['sidebar-shell', mobileMenuOpen && 'is-open', collapsed && 'is-collapsed']">
      <div class="sidebar-header">
        <BrandMark
          title="一证通行"
          subtitle="安全可信"
          contrast
        />
        <button
          class="collapse-toggle focus-ring"
          aria-label="折叠侧边栏"
          @click="toggleCollapsed"
        >
          <Icon name="chevron-left" size="14px" />
        </button>
      </div>

      <button
        class="sidebar-expand-btn focus-ring"
        aria-label="展开侧边栏"
        @click="setCollapsed(false)"
      >
        <Icon name="chevron-right" size="14px" />
      </button>

      <!-- Navigation -->
      <nav class="sidebar-nav">
        <div class="sidebar-section-title px-3 pb-3">用户中心</div>
        <router-link
          v-for="item in visibleNavItems"
          :key="item.key"
          :to="item.to"
          class="nav-link"
        >
          <Icon :name="item.icon" size="18px" />
          <span class="sidebar-label text-sm font-medium">{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="sidebar-theme-panel">
        <p class="sidebar-section-title px-0 pb-3">显示模式</p>
        <ThemeSwitch />
      </div>

      <!-- Footer -->
      <div class="sidebar-footer">
        <div class="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
          <div class="user-card flex items-center gap-3">
            <div class="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-sm font-bold text-white uppercase">
              {{ userDisplayName[0] }}
            </div>
            <div class="sidebar-footer-info min-w-0">
              <p class="truncate text-sm font-semibold text-slate-100">{{ userDisplayName }}</p>
              <p class="truncate text-xs text-slate-500">{{ authStore.user?.email || '—' }}</p>
            </div>
          </div>

          <div class="sidebar-footer-info mt-3 flex items-center justify-between">
            <span class="text-xs text-slate-500">当前角色</span>
            <span class="tag tag-info">{{ isAdmin ? 'Admin' : 'User' }}</span>
          </div>

          <a
            class="sidebar-footer-info nav-link mt-3 cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10"
            @click.prevent="logout"
          >
            <Icon name="logout" size="16px" />
            <span class="text-sm font-medium">退出登录</span>
          </a>
        </div>
      </div>
    </aside>

    <!-- Main -->
    <main class="console-main">
      <header class="console-topbar">
        <div class="flex min-w-0 items-center gap-3">
          <button
            class="mobile-nav-toggle focus-ring inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-primary)] bg-transparent text-[var(--text-primary)]"
            aria-label="打开导航"
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <Icon name="menu-fold" size="18px" />
          </button>

          <div class="console-title-block">
            <p class="console-breadcrumb">用户中心 / {{ route.meta.title }}</p>
            <h1 class="truncate text-lg font-bold tracking-[-0.02em] text-[var(--text-primary)]">
              {{ route.meta.title }}
            </h1>
          </div>
        </div>

        <div class="page-actions console-topbar-actions">
          <div id="console-route-actions" class="console-route-actions"></div>
          <ThemeSwitch />
        </div>
      </header>

      <div class="console-body">
        <section v-if="bootstrapping" class="flex min-h-[300px] items-center justify-center text-[var(--text-muted)]">
          <div class="flex items-center gap-3">
            <Icon name="loading" size="20px" class="animate-spin" />
            <span class="text-sm font-medium">同步会话中...</span>
          </div>
        </section>
        <router-view v-else />
      </div>
    </main>
  </div>
</template>
