import { createRouter, createWebHistory } from 'vue-router'
import http from '../api/http'

let setupChecked = false
let systemInitialized = false
const AUTH_STORAGE_KEY = 'sso-auth-session'

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
  const rawSession = window.localStorage.getItem(AUTH_STORAGE_KEY)
  let hasUser = false
  let role: 'admin' | 'user' | null = null

  if (rawSession) {
    try {
      const session = JSON.parse(rawSession) as {
        user?: { role?: 'admin' | 'user' }
      }
      hasUser = Boolean(session.user)
      role = session.user?.role ?? null
    } catch {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
    }
  }

  return { hasUser, role }
}

async function probeSessionSnapshot() {
  try {
    const { data } = await http.get('/api/auth/session')
    const user = data as { role?: 'admin' | 'user' }
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user }))
    return {
      hasUser: true,
      role: user.role ?? null,
    }
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    return { hasUser: false, role: null }
  }
}

const wechatTestRoutes = import.meta.env.DEV
  ? [
      {
        path: 'wechat-test',
        name: 'WechatTest',
        component: () => import('../views/WechatMiniTest.vue'),
        meta: { title: '微信扫码测试', description: '微信扫码登录联调页面' },
      },
    ]
  : [
      {
        path: 'wechat-test',
        redirect: '/login',
      },
    ]

const opsRoutes = import.meta.env.DEV
  ? [
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
    ]
  : [
      {
        path: '/ops/:pathMatch(.*)*',
        redirect: '/user/system',
      },
    ]

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('../views/Home.vue'),
      meta: { title: '首页', description: '一证通行门户导航' },
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
        ...wechatTestRoutes,
      ],
    },
    {
      path: '/setup',
      name: 'Setup',
      component: () => import('../views/Setup.vue'),
      meta: { title: '系统初始化', description: '完成服务配置与首个管理员创建' },
    },
    {
      path: '/user',
      component: () => import('../layouts/ConsoleLayout.vue'),
      redirect: '/user/account',
      children: [
        {
          path: 'overview',
          name: 'UserOverview',
          component: () => import('../views/console/Overview.vue'),
          meta: { title: '运营概览', description: '查看系统运行、应用接入和安全事件概况', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'users',
          name: 'UserUsers',
          component: () => import('../views/console/Users.vue'),
          meta: { title: '用户管理', description: '管理用户生命周期、状态、角色和绑定关系', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'applications',
          name: 'UserApplications',
          component: () => import('../views/console/Applications.vue'),
          meta: { title: '应用接入', description: '配置客户端、回调地址、Scope 与注册策略', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'docs',
          name: 'UserIntegrationDocs',
          component: () => import('../views/console/IntegrationDocs.vue'),
          meta: { title: '对接文档', description: 'OAuth2 / OIDC 应用接入流程与接口说明', requiresAuth: true },
        },
        {
          path: 'audit',
          name: 'UserAudit',
          component: () => import('../views/console/Audit.vue'),
          meta: { title: '审计日志', description: '查询认证、授权、后台与系统操作事件', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'system',
          name: 'UserSystem',
          component: () => import('../views/console/System.vue'),
          meta: { title: '系统设置', description: '维护认证策略、第三方登录、邮件与运维配置', requiresAuth: true, requiresAdmin: true },
        },
        {
          path: 'account',
          name: 'UserAccount',
          component: () => import('../views/console/Account.vue'),
          meta: { title: '我的账号', description: '查看个人资料、活跃会话和第三方绑定', requiresAuth: true },
        },
      ],
    },
    ...opsRoutes,
    {
      path: '/dashboard',
      redirect: '/user/account',
    },
    {
      path: '/auth/login',
      redirect: '/login',
    },
    {
      path: '/admin/:pathMatch(.*)*',
      redirect: '/user/overview',
    },
    {
      path: '/console/:pathMatch(.*)*',
      redirect: (to) => ({
        path: to.path.replace(/^\/console/, '/user'),
        query: to.query,
        hash: to.hash,
      }),
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

  const hasAuthorizeContext =
    typeof to.query.client_id === 'string' &&
    typeof to.query.redirect_uri === 'string'
  let session = readSessionSnapshot()

  if (!session.hasUser && (to.meta.requiresAuth || (to.path === '/login' && !hasAuthorizeContext))) {
    session = await probeSessionSnapshot()
  }

  if (to.path === '/login' && session.hasUser && !hasAuthorizeContext) {
    return typeof to.query.redirect === 'string'
      ? to.query.redirect
      : session.role === 'admin' ? '/user/overview' : '/user/account'
  }

  if (to.meta.requiresAuth && !session.hasUser) {
    return {
      path: '/login',
      query: { redirect: to.fullPath },
    }
  }

  if (to.meta.requiresAdmin && session.role !== 'admin') {
    return session.hasUser ? '/user/account' : '/login'
  }

  return true
})

router.afterEach((to) => {
  const pageTitle = typeof to.meta.title === 'string' ? to.meta.title : '一证通行'
  document.title = `${pageTitle} | 一证通行`
})

export default router
