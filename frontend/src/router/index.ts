import { createRouter, createWebHistory } from 'vue-router'
import http from '../api/http'

let setupChecked = false
let systemInitialized = false

export function resetSetupCache() {
  setupChecked = false
  systemInitialized = false
}

async function checkSetupStatus(): Promise<boolean> {
  if (setupChecked) return systemInitialized
  try {
    const { data } = await http.get('/api/setup/status')
    systemInitialized = (data as { initialized: boolean }).initialized
  } catch {
    systemInitialized = false
  }
  setupChecked = true
  return systemInitialized
}

function readSessionSnapshot() {
  const rawSession = window.localStorage.getItem('sso-auth-session')
  let hasToken = false
  let role: 'admin' | 'user' | null = null

  if (rawSession) {
    try {
      const session = JSON.parse(rawSession) as {
        accessToken?: string
        user?: { role?: 'admin' | 'user' }
      }
      hasToken = Boolean(session.accessToken)
      role = session.user?.role ?? null
    } catch {
      window.localStorage.removeItem('sso-auth-session')
    }
  }

  return { hasToken, role }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/login',
    },
    {
      path: '/',
      component: () => import('../layouts/AuthLayout.vue'),
      children: [
        {
          path: 'login',
          name: 'Login',
          component: () => import('../views/Login.vue'),
          meta: { title: '统一登录', description: '账号密码、邮箱验证码、注册与 OAuth 授权入口' },
        },
        {
          path: 'oauth/callback',
          name: 'OAuthCallback',
          component: () => import('../views/OAuthCallback.vue'),
          meta: { title: 'OAuth 回调', description: '授权回调处理状态' },
        },
        {
          path: 'social/callback',
          name: 'SocialCallback',
          component: () => import('../views/SocialCallback.vue'),
          meta: { title: '第三方回调', description: '第三方登录回调状态' },
        },
      ],
    },
    {
      path: '/setup',
      name: 'Setup',
      component: () => import('../views/Setup.vue'),
      meta: { title: '系统初始化', description: '完成服务配置与首个管理员创建' },
    },
    {
      path: '/console',
      component: () => import('../layouts/ConsoleLayout.vue'),
      redirect: '/console/overview',
      children: [
        {
          path: 'overview',
          name: 'ConsoleOverview',
          component: () => import('../views/console/Overview.vue'),
          meta: { title: '运营概览', description: '查看系统运行、应用接入和安全事件概况', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'users',
          name: 'ConsoleUsers',
          component: () => import('../views/console/Users.vue'),
          meta: { title: '用户管理', description: '管理用户生命周期、状态、角色和绑定关系', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'applications',
          name: 'ConsoleApplications',
          component: () => import('../views/console/Applications.vue'),
          meta: { title: '应用接入', description: '配置客户端、回调地址、Scope 与注册策略', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'audit',
          name: 'ConsoleAudit',
          component: () => import('../views/console/Audit.vue'),
          meta: { title: '审计日志', description: '查询认证、授权、后台与系统操作事件', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'system',
          name: 'ConsoleSystem',
          component: () => import('../views/console/System.vue'),
          meta: { title: '系统设置', description: '维护认证策略、第三方登录、邮件与运维配置', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'account',
          name: 'ConsoleAccount',
          component: () => import('../views/console/Account.vue'),
          meta: { title: '我的账号', description: '查看个人资料、活跃会话和第三方绑定', requiresAuth: true },
        },
      ],
    },
    {
      path: '/ops',
      component: () => import('../layouts/ConsoleLayout.vue'),
      redirect: '/ops/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'OpsDashboard',
          component: () => import('../views/ops/Dashboard.vue'),
          meta: { title: '运维仪表盘', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'standard',
          name: 'OpsStandardDashboard',
          component: () => import('../views/ops/StandardDashboard.vue'),
          meta: { title: '标准仪表盘', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'aether/overview',
          name: 'OpsAetherOverview',
          component: () => import('../views/ops/AetherOverview.vue'),
          meta: { title: 'Aether 概览', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'aether/nodes',
          name: 'OpsAetherNodes',
          component: () => import('../views/ops/AetherNodes.vue'),
          meta: { title: 'Aether 节点', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'resources',
          name: 'OpsResources',
          component: () => import('../views/ops/Resources.vue'),
          meta: { title: '资源管理', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'settings',
          name: 'OpsSettings',
          component: () => import('../views/ops/Settings.vue'),
          meta: { title: '运维设置', requiresAuth: true, requiresAdmin: true },
        },
      ],
    },
    {
      path: '/dashboard',
      redirect: '/console/overview',
    },
    {
      path: '/auth/login',
      redirect: '/login',
    },
    {
      path: '/admin/:pathMatch(.*)*',
      redirect: '/console/overview',
    },
  ],
})

router.beforeEach(async (to) => {
  const initialized = await checkSetupStatus()

  if (to.path === '/setup') {
    return initialized ? { path: '/login' } : true
  }

  if (!initialized && to.path !== '/setup') {
    return { path: '/setup' }
  }

  const session = readSessionSnapshot()
  const hasAuthorizeContext =
    typeof to.query.client_id === 'string' &&
    typeof to.query.redirect_uri === 'string'

  if (to.path === '/login' && session.hasToken && !hasAuthorizeContext) {
    return typeof to.query.redirect === 'string'
      ? to.query.redirect
      : session.role === 'admin'
        ? '/console/overview'
        : '/console/account'
  }

  if (to.meta.requiresAuth && !session.hasToken) {
    return {
      path: '/login',
      query: { redirect: to.fullPath },
    }
  }

  if (to.meta.requiresAdmin && session.role !== 'admin') {
    return session.hasToken ? '/console/account' : '/login'
  }

  return true
})

router.afterEach((to) => {
  const pageTitle = typeof to.meta.title === 'string' ? to.meta.title : '认证中心'
  document.title = `${pageTitle} | Nexus SSO`
})

export default router
