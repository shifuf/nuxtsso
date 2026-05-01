<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { useAuthStore } from '../stores/auth'
import { consoleNavItems } from '../utils/console'
import { useSidebarCollapsed } from '../composables/useSidebarCollapsed'
import BrandMark from '../components/BrandMark.vue'
import StatusTag from '../components/StatusTag.vue'
import ThemeSwitch from '../components/ThemeSwitch.vue'

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
    void router.replace('/console/account')
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
  authStore.clearSession()
  router.push('/login')
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
      class="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm md:hidden"
      @click="mobileMenuOpen = false"
    />

    <!-- Sidebar -->
    <aside :class="['sidebar-shell', mobileMenuOpen && 'is-open', collapsed && 'is-collapsed']">
      <div class="sidebar-header">
        <BrandMark
          title="Nexus SSO"
          subtitle="安全可信 · 状态清晰"
          contrast
        />
        <button
          class="collapse-toggle focus-ring"
          aria-label="折叠侧边栏"
          @click="toggleCollapsed"
        >
          <t-icon name="chevron-left" size="14px" />
        </button>
      </div>

      <button
        class="sidebar-expand-btn focus-ring"
        aria-label="展开侧边栏"
        @click="setCollapsed(false)"
      >
        <t-icon name="chevron-right" size="14px" />
      </button>

      <!-- Status -->
      <div class="sidebar-section">
        <div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">服务状态</p>
              <p class="mt-2 text-sm font-semibold text-slate-100">OIDC / OAuth2 / 审计在线</p>
            </div>
            <span class="tag tag-success">就绪</span>
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="sidebar-nav">
        <div class="sidebar-section-title px-3 pb-3">控制台</div>
        <router-link
          v-for="item in visibleNavItems"
          :key="item.key"
          :to="item.to"
          class="nav-link"
        >
          <t-icon :name="item.icon" size="18px" />
          <span class="sidebar-label text-sm font-medium">{{ item.label }}</span>
        </router-link>
      </nav>

      <!-- Footer -->
      <div class="sidebar-footer">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div class="user-card flex items-center gap-3">
            <div class="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-sm font-semibold text-white uppercase">
              {{ userDisplayName[0] }}
            </div>
            <div class="sidebar-footer-info min-w-0">
              <p class="truncate text-sm font-semibold text-slate-100">{{ userDisplayName }}</p>
              <p class="truncate text-xs text-slate-400">{{ authStore.user?.email || '—' }}</p>
            </div>
          </div>

          <div class="sidebar-footer-info mt-4 flex items-center justify-between">
            <span class="text-xs text-slate-400">当前角色</span>
            <span class="tag tag-info">{{ isAdmin ? 'Admin' : 'User' }}</span>
          </div>

          <a
            class="sidebar-footer-info nav-link mt-3 cursor-pointer text-red-400 hover:text-red-300"
            @click.prevent="logout"
          >
            <t-icon name="logout" size="16px" />
            <span class="text-sm font-medium">退出登录</span>
          </a>
        </div>
      </div>
    </aside>

    <!-- Main -->
    <main class="console-main">
      <header class="console-topbar">
        <div class="flex min-w-0 items-start gap-3">
          <button
            class="mobile-nav-toggle panel-muted focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border-0 bg-transparent text-[var(--text-primary)]"
            aria-label="打开导航"
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <t-icon name="menu-fold" size="18px" />
          </button>

          <div class="min-w-0">
            <p class="eyebrow">集中认证控制台</p>
            <h1 class="mt-1 truncate text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              {{ route.meta.title }}
            </h1>
            <p class="mt-1 hidden text-sm text-[var(--text-muted)] md:block">
              {{ route.meta.description }}
            </p>
          </div>
        </div>

        <div class="page-actions">
          <StatusTag tone="success" label="Service Active" />
          <ThemeSwitch />
        </div>
      </header>

      <div class="console-body">
        <section v-if="bootstrapping" class="flex min-h-[300px] items-center justify-center text-[var(--text-muted)]">
          同步会话中...
        </section>
        <router-view v-else />
      </div>
    </main>
  </div>
</template>
