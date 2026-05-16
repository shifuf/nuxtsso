<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTheme } from '../composables/useTheme'
import { authApi } from '../api/auth'
import type { SiteConfig } from '../types/api'

type PortalTab = 'home' | 'oauth' | 'contact'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { resolvedTheme, setTheme } = useTheme()
const activeTab = ref<PortalTab>('home')

const userCenterPath = computed(() => (
  authStore.user?.role === 'admin' ? '/user/overview' : '/user/account'
))

const entryLabel = computed(() => (authStore.isAuthenticated ? '用户中心' : '登录'))
const entryPath = computed(() => (authStore.isAuthenticated ? userCenterPath.value : '/login'))
const siteConfig = reactive<SiteConfig>({
  siteName: '一证通行',
  footerCopyright: '© 2026 一证通行. All rights reserved.',
  icpNumber: '',
})

const navItems: Array<{ key: PortalTab; label: string }> = [
  { key: 'home', label: '首页' },
  { key: 'oauth', label: 'OAuth文档' },
  { key: 'contact', label: '联系我们' },
]

const oauthSteps = [
  { title: '创建应用', desc: '在用户中心登记应用名称、回调地址和授权范围。' },
  { title: '发起授权', desc: '业务系统将用户重定向至一证通行授权地址。' },
  { title: '获取授权码', desc: '用户确认授权后，系统携带 code 与 state 回跳业务系统。' },
  { title: '换取令牌', desc: '业务系统后端使用 code、Client ID 和 Client Secret 获取令牌。' },
]

const features = [
  { icon: 'secured', tone: 'cyan', title: '安全可靠', desc: '统一管理账号身份、授权范围和访问令牌，降低应用侧重复建设成本。' },
  { icon: 'link', tone: 'blue', title: '统一认证', desc: '一次登录，畅通全部服务，支持账号体系与多应用授权集中治理。' },
  { icon: 'key', tone: 'orange', title: 'OAuth 2.0', desc: '支持标准授权码模式，便于第三方系统以规范流程快速接入。' },
]

const usageSteps = [
  { icon: 'user-add', title: '注册账号', desc: '完成账号资料与邮箱验证。' },
  { icon: 'key', title: '获取密钥', desc: '创建应用并获取 Client ID 与 Client Secret。' },
  { icon: 'code', title: '集成接入', desc: '按 OAuth 文档完成授权跳转、回调与令牌交换。' },
]

const oauthEndpoints = [
  { name: '授权地址', method: 'GET', url: '/login' },
  { name: '令牌接口', method: 'POST', url: '/api/oauth/token' },
  { name: '用户信息', method: 'GET', url: '/api/oauth/userinfo' },
]

const authorizeFields = [
  { name: 'client_id', required: '是', desc: '应用的 Client ID。' },
  { name: 'redirect_uri', required: '是', desc: '应用登记过的回调地址。' },
  { name: 'scope', required: '否', desc: '授权范围，多个值使用空格分隔。' },
  { name: 'state', required: '建议', desc: '业务系统生成的随机字符串，用于防止 CSRF。' },
]

const tokenFields = [
  { name: 'access_token', desc: '访问令牌，用于调用用户信息接口。' },
  { name: 'refresh_token', desc: '刷新令牌，用于续期访问令牌。' },
  { name: 'token_type', desc: '令牌类型，固定返回 Bearer。' },
  { name: 'expires_in', desc: '访问令牌有效期，单位为秒。' },
  { name: 'scope', desc: '本次授权实际授予的权限范围。' },
]

const userInfoFields = [
  { name: 'sub', desc: '用户唯一标识。' },
  { name: 'username', desc: '用户名。' },
  { name: 'email', desc: '邮箱地址。' },
  { name: 'email_verified', desc: '邮箱是否已验证。' },
  { name: 'avatar', desc: '用户头像地址。' },
]

const scopes = [
  { name: 'openid', desc: '基础身份标识，建议所有应用默认申请。' },
  { name: 'profile', desc: '用户名、头像等基础资料。' },
  { name: 'email', desc: '邮箱地址及邮箱验证状态。' },
]

onMounted(async () => {
  const tab = route.query.tab
  if (tab === 'oauth' || tab === 'contact') activeTab.value = tab

  try {
    Object.assign(siteConfig, await authApi.getSiteConfig())
  } catch {
    // Keep defaults when public config is unavailable.
  }
})

watch(() => route.query.tab, (tab) => {
  if (tab === 'oauth' || tab === 'contact') activeTab.value = tab
  else activeTab.value = 'home'
})

function toggleTheme() {
  setTheme(resolvedTheme.value === 'dark' ? 'light' : 'dark')
}
</script>

<template>
  <main class="portal-shell">
    <header class="portal-topbar">
      <button class="portal-brand" type="button" @click="activeTab = 'home'">
        <span class="portal-brand__mark"><t-icon name="secured" size="20px" /></span>
        <span>{{ siteConfig.siteName }}</span>
      </button>

      <nav class="portal-nav" aria-label="门户导航">
        <button
          v-for="item in navItems"
          :key="item.key"
          :class="{ 'is-active': activeTab === item.key }"
          type="button"
          @click="activeTab = item.key"
        >
          {{ item.label }}
        </button>
      </nav>

      <div class="portal-actions">
        <button class="icon-action" type="button" aria-label="切换主题" @click="toggleTheme">
          <t-icon :name="resolvedTheme === 'dark' ? 'sunny' : 'moon'" size="18px" />
        </button>
        <button class="text-action" type="button" @click="router.push(entryPath)">
          {{ entryLabel }}
        </button>
      </div>
    </header>

    <template v-if="activeTab === 'home'">
      <section class="portal-hero">
        <div class="portal-hero__inner">
          <p class="portal-kicker">{{ siteConfig.siteName }}</p>
          <h1>一个账号，畅通全部服务。</h1>
          <p>
            支持 OAuth 2.0 标准协议，为您的应用提供安全、便捷的身份认证。
          </p>
          <div class="portal-hero__actions">
            <button class="primary-action primary-action--light" type="button" @click="router.push(entryPath)">
              {{ authStore.isAuthenticated ? '进入用户中心' : '立即使用' }}
              <span aria-hidden="true">-&gt;</span>
            </button>
            <button class="secondary-action secondary-action--hero" type="button" @click="activeTab = 'oauth'">
              OAuth 文档
            </button>
          </div>
        </div>
      </section>

      <section class="feature-section">
        <div class="section-heading">
          <h2>系统特点</h2>
          <p>为开发者和用户提供安全、高效、易用的身份认证解决方案。</p>
        </div>
        <div class="feature-grid">
          <article v-for="item in features" :key="item.title" :class="['feature-card', `feature-card--${item.tone}`]">
            <span><t-icon :name="item.icon" size="26px" /></span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.desc }}</p>
          </article>
        </div>
      </section>

      <section class="usage-section">
        <div class="section-heading">
          <h2>如何使用</h2>
          <p>三步完成集成，快速接入统一身份认证。</p>
        </div>
        <div class="usage-grid">
          <article v-for="(item, index) in usageSteps" :key="item.title" class="usage-card">
            <strong>{{ index + 1 }}</strong>
            <span><t-icon :name="item.icon" size="30px" /></span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.desc }}</p>
          </article>
        </div>
      </section>
    </template>

    <section v-else-if="activeTab === 'oauth'" class="doc-page">
      <div class="doc-heading">
        <h1>OAuth 2.0 开发文档</h1>
        <p>一证通行支持授权码模式，适用于具备后端服务的 Web 应用和内部业务系统。</p>
      </div>

      <div class="doc-card toc-card">
        <h2>目录</h2>
        <div class="toc-grid">
          <span>概述</span>
          <span>快速开始</span>
          <span>接口端点</span>
          <span>权限范围</span>
          <span>完整示例</span>
          <span>客户端凭证</span>
          <span>安全建议</span>
          <span>错误处理</span>
        </div>
      </div>

      <div class="doc-card">
        <h2>概述</h2>
        <p>
          OAuth 2.0 是行业标准授权协议。第三方应用可在用户授权后访问一证通行中的身份数据，
          无需接触用户密码，降低凭据泄露风险。
        </p>
        <h3>支持的授权流程</h3>
        <p>当前支持授权码模式（Authorization Code），适用于具备后端服务的 Web 应用。</p>
      </div>

      <div class="doc-card">
        <h2>接口端点</h2>
        <div class="endpoint-list">
          <div v-for="item in oauthEndpoints" :key="item.url" class="endpoint-item">
            <span>{{ item.method }}</span>
            <code>{{ item.url }}</code>
            <p>{{ item.name }}</p>
          </div>
        </div>
      </div>

      <div class="doc-card">
        <h2>授权请求字段</h2>
        <div class="field-table">
          <div class="field-row field-row--head">
            <span>字段</span>
            <span>必填</span>
            <span>说明</span>
          </div>
          <div v-for="field in authorizeFields" :key="field.name" class="field-row">
            <code>{{ field.name }}</code>
            <span>{{ field.required }}</span>
            <p>{{ field.desc }}</p>
          </div>
        </div>
        <pre>GET /login?client_id=CLIENT_ID&amp;redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&amp;scope=openid%20profile%20email&amp;state=STATE</pre>
      </div>

      <div class="doc-card">
        <h2>令牌返回字段</h2>
        <div class="scope-list">
          <div v-for="field in tokenFields" :key="field.name">
            <code>{{ field.name }}</code>
            <p>{{ field.desc }}</p>
          </div>
        </div>
        <pre>{
  "access_token": "ACCESS_TOKEN",
  "refresh_token": "REFRESH_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email"
}</pre>
      </div>

      <div class="doc-card">
        <h2>用户信息返回字段</h2>
        <div class="scope-list">
          <div v-for="field in userInfoFields" :key="field.name">
            <code>{{ field.name }}</code>
            <p>{{ field.desc }}</p>
          </div>
        </div>
        <pre>{
  "sub": "user_123",
  "username": "demo",
  "email": "demo@example.com",
  "email_verified": true,
  "avatar": "https://example.com/avatar.png"
}</pre>
      </div>

      <div class="doc-card">
        <h2>快速开始</h2>
        <div class="step-grid">
          <div v-for="(step, index) in oauthSteps" :key="step.title" class="step-card">
            <span>{{ index + 1 }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.desc }}</p>
          </div>
        </div>
      </div>

      <div class="doc-card">
        <h2>权限范围</h2>
        <div class="scope-list">
          <div v-for="scope in scopes" :key="scope.name">
            <code>{{ scope.name }}</code>
            <p>{{ scope.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <section v-else class="doc-page">
      <div class="doc-heading">
        <h1>联系我们</h1>
        <p>如需接入一证通行，请联系平台管理员获取应用接入权限与 Client 凭证。</p>
      </div>

      <div class="doc-card contact-card">
        <div>
          <h2>接入支持</h2>
          <p>请提供业务系统名称、回调地址、需要申请的 Scope，以及上线时间计划。</p>
        </div>
        <button class="primary-action" type="button" @click="router.push(entryPath)">
          进入接入入口
        </button>
      </div>
    </section>

    <footer class="portal-footer">
      <p>{{ siteConfig.footerCopyright }}</p>
      <p v-if="siteConfig.icpNumber">{{ siteConfig.icpNumber }}</p>
    </footer>
  </main>
</template>

<style scoped>
.portal-shell {
  min-height: 100vh;
  background: var(--bg-page);
  color: var(--text-primary);
}

.portal-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: 280px 1fr 220px;
  align-items: center;
  min-height: 52px;
  border-bottom: 1px solid var(--border-primary);
  padding: 0 clamp(18px, 7vw, 118px);
  background: color-mix(in srgb, var(--surface-secondary) 88%, transparent);
  backdrop-filter: blur(18px);
}

.portal-brand,
.portal-nav button,
.icon-action,
.text-action,
.primary-action,
.secondary-action {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.portal-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  background: transparent;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
}

.portal-brand__mark {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  background: #17233c;
  color: #fff;
  box-shadow: 0 14px 32px -18px rgba(37, 99, 235, 0.8);
}

.portal-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.portal-nav button,
.text-action {
  position: relative;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
}

.portal-nav button {
  border-radius: 999px;
  padding: 8px 14px;
  transition: background-color 140ms ease, color 140ms ease;
}

.portal-nav button.is-active,
.portal-nav button:hover,
.text-action:hover {
  color: var(--text-primary);
}

.portal-nav button.is-active {
  background: var(--surface-muted);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px var(--border-primary);
}

.portal-nav button:hover:not(.is-active) {
  background: color-mix(in srgb, var(--surface-muted) 70%, transparent);
}

.portal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 22px;
}

.icon-action {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
}

.icon-action:hover {
  background: var(--surface-muted);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.portal-hero {
  position: relative;
  display: grid;
  min-height: 520px;
  overflow: hidden;
  place-items: center;
  padding: 86px 24px 130px;
  background: #101a32;
}

.portal-hero::before,
.portal-hero::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.portal-hero::before {
  right: -10%;
  bottom: -112px;
  left: -10%;
  height: 210px;
  border-radius: 50% 50% 0 0 / 72% 72% 0 0;
  background: var(--bg-page);
  z-index: 1;
}

.portal-hero::after {
  inset: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  opacity: 1;
}

.portal-hero__inner {
  position: relative;
  z-index: 2;
  max-width: 820px;
  text-align: center;
  animation: portal-rise 420ms ease both;
}

.portal-kicker {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  margin: 0 0 18px;
  padding: 9px 16px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.86);
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.16em;
  backdrop-filter: blur(10px);
}

.portal-hero h1,
.doc-heading h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(42px, 6vw, 72px);
  font-weight: 950;
  line-height: 1;
  letter-spacing: -0.06em;
}

.portal-hero h1 {
  color: #fff;
  text-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
}

.doc-heading h1 {
  color: var(--text-primary);
}

.portal-hero p,
.doc-heading p {
  max-width: 720px;
  margin: 22px auto 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.8;
}

.portal-hero p {
  color: rgba(226, 232, 240, 0.88);
}

.doc-heading p {
  color: var(--text-secondary);
}

.portal-hero__actions {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 34px;
  flex-wrap: wrap;
}

.feature-section,
.usage-section {
  padding: 86px clamp(18px, 7vw, 118px);
}

.feature-section {
  background: var(--bg-page);
}

.usage-section {
  background: var(--surface-secondary);
}

.section-heading {
  max-width: 760px;
  margin: 0 auto 58px;
  text-align: center;
}

.section-heading h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(34px, 4vw, 44px);
  font-weight: 950;
  letter-spacing: -0.06em;
}

.section-heading p {
  margin: 14px 0 0;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1.8;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
  width: min(1060px, 100%);
  margin: 0 auto;
}

.feature-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border-primary);
  border-radius: 18px;
  padding: 34px 30px;
  background: var(--surface-secondary);
  box-shadow: 0 22px 58px -48px rgba(15, 23, 42, 0.65);
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.feature-card::after {
  content: '';
  position: absolute;
  top: -44px;
  right: -42px;
  width: 140px;
  height: 140px;
  border-radius: 999px;
  opacity: 0.14;
  background: currentColor;
}

.feature-card:hover,
.doc-card:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border-primary));
  box-shadow: 0 28px 58px -42px rgba(15, 23, 42, 0.62);
}

.feature-card span {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 16px;
  background: #17233c;
  color: #fff;
}

.feature-card--cyan {
  color: #0ea5e9;
}

.feature-card--cyan span {
  background: #0ea5e9;
}

.feature-card--blue {
  color: #2563eb;
}

.feature-card--blue span {
  background: #2563eb;
}

.feature-card--orange {
  color: #f97316;
}

.feature-card--orange span {
  background: #f97316;
}

.feature-card h3,
.usage-card h3 {
  margin: 22px 0 12px;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 950;
}

.feature-card p,
.usage-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.8;
}

.usage-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 42px;
  max-width: 920px;
  margin: 0 auto;
}

.usage-grid::before {
  content: '';
  position: absolute;
  top: 48px;
  right: 16%;
  left: 16%;
  height: 1px;
  background: var(--border-strong);
}

.usage-card {
  position: relative;
  text-align: center;
}

.usage-card strong {
  position: absolute;
  top: -9px;
  right: calc(50% - 52px);
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 999px;
  background: #17233c;
  color: #fff;
  font-size: 14px;
}

.usage-card span {
  display: grid;
  width: 96px;
  height: 96px;
  margin: 0 auto;
  place-items: center;
  border-radius: 14px;
  background: var(--surface-muted);
  color: #17233c;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 12px;
  min-height: 44px;
  padding: 0 22px;
  font-size: 14px;
  font-weight: 900;
}

.primary-action {
  background: #2563eb;
  color: #fff;
  box-shadow: var(--shadow-accent);
  transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
}

.primary-action--light {
  background: #fff;
  color: #101a32;
  box-shadow: 0 18px 42px -24px rgba(0, 0, 0, 0.58);
}

.primary-action:hover {
  filter: saturate(1.12);
  transform: translateY(-1px);
  box-shadow: 0 22px 48px -26px rgba(37, 99, 235, 0.85);
}

.primary-action--light:hover {
  box-shadow: 0 22px 46px -24px rgba(0, 0, 0, 0.66);
}

.secondary-action {
  border: 1px solid var(--border-primary);
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.secondary-action--hero {
  border-color: rgba(255, 255, 255, 0.34);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  backdrop-filter: blur(10px);
}

.secondary-action--hero:hover {
  background: rgba(255, 255, 255, 0.14);
}

.doc-page {
  width: min(1088px, calc(100% - 36px));
  margin: 0 auto;
  padding: 48px 0 96px;
}

.doc-heading {
  padding: 4px 0 44px;
  text-align: center;
}

.doc-heading h1 {
  font-size: clamp(34px, 4vw, 44px);
}

.doc-heading p {
  font-size: 16px;
}

.doc-card {
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  margin-top: 28px;
  padding: 26px;
  background: var(--surface-secondary);
  box-shadow: var(--shadow-card);
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}

.doc-card h2 {
  margin: 0 0 18px;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 950;
  letter-spacing: -0.04em;
}

.doc-card h3 {
  margin: 18px 0 8px;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
}

.doc-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.8;
}

.doc-card pre {
  overflow: auto;
  border-radius: 14px;
  margin: 18px 0 0;
  padding: 16px;
  background: var(--surface-contrast);
  color: var(--text-contrast);
  font-size: 13px;
  line-height: 1.7;
}

.toc-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 22px 44px;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 800;
}

.toc-grid span {
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--surface-muted);
  transition: background-color 160ms ease, color 160ms ease, transform 160ms ease;
}

.toc-grid span:hover {
  background: var(--accent-soft);
  color: var(--accent);
  transform: translateX(3px);
}

.endpoint-list,
.scope-list {
  display: grid;
  gap: 12px;
}

.endpoint-item {
  display: grid;
  grid-template-columns: 72px minmax(220px, 0.7fr) 1fr;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--border-primary);
  border-radius: 14px;
  padding: 14px;
  background: var(--surface-muted);
  transition: border-color 160ms ease, transform 160ms ease;
}

.endpoint-item:hover,
.field-row:not(.field-row--head):hover,
.scope-list div:hover {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border-primary));
  transform: translateX(3px);
}

.endpoint-item span {
  color: var(--accent);
  font-size: 12px;
  font-weight: 950;
}

.endpoint-item code,
.scope-list code {
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 800;
}

.field-table {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border-primary);
  border-radius: 14px;
}

.field-row {
  display: grid;
  grid-template-columns: 160px 90px 1fr;
  gap: 16px;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
  padding: 13px 16px;
  transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
}

.field-row:last-child {
  border-bottom: 0;
}

.field-row--head {
  background: var(--surface-muted);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 950;
}

.field-row code {
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 800;
}

.field-row span,
.field-row p {
  color: var(--text-secondary);
  font-size: 14px;
}

.step-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.step-card {
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  padding: 20px;
  background: var(--surface-muted);
}

.step-card span {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 999px;
  background: #17233c;
  color: #fff;
  font-weight: 950;
}

.scope-list div {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 16px;
  border-bottom: 1px solid var(--border-subtle);
  padding: 12px 0;
  transition: border-color 160ms ease, transform 160ms ease;
}

.scope-list div:last-child {
  border-bottom: 0;
}

.contact-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.portal-footer {
  border-top: 1px solid var(--border-primary);
  padding: 24px clamp(18px, 7vw, 118px);
  background: #0f172a;
  color: #cbd5e1;
  text-align: center;
}

@keyframes portal-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.portal-footer p {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
}

.portal-footer p + p {
  color: #94a3b8;
}

@media (max-width: 900px) {
  .portal-topbar {
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 14px 18px;
  }

  .portal-nav,
  .portal-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .endpoint-item,
  .field-row,
  .scope-list div,
  .step-grid,
  .toc-grid,
  .feature-grid,
  .usage-grid {
    grid-template-columns: 1fr;
  }

  .contact-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .usage-grid::before,
  .portal-hero::after {
    display: none;
  }

  .portal-hero {
    min-height: 470px;
    padding: 74px 18px 108px;
  }

  .portal-hero::before {
    bottom: -126px;
    height: 190px;
  }

}
</style>
