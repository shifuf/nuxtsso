<script setup lang="ts">
import { NButton } from 'naive-ui'
import PageHeader from '../../components/PageHeader.vue'
import StatusTag from '../../components/StatusTag.vue'

const origin = window.location.origin
const endpoints = [
  { name: '授权地址', value: `${origin}/login?client_id=CLIENT_ID&redirect_uri=CALLBACK_URL&scope=openid profile email&state=STATE` },
  { name: '回调地址', value: '由业务系统提供，例如 https://app.example.com/oauth/callback' },
  { name: '令牌接口', value: `${origin}/oauth2/token` },
  { name: '用户信息', value: `${origin}/oauth2/userinfo` },
]

const steps = [
  '在“应用接入”中新建应用，填写应用名称、回调地址和 Scope。',
  '复制系统生成的 Client ID 与 Client Secret，并保存到业务系统后端。',
  '业务系统把用户重定向到授权地址，携带 client_id、redirect_uri、scope、state。',
  '用户在认证中心完成登录并授权后，认证中心回跳到 redirect_uri，并携带 code 与 state。',
  '业务系统后端使用 code、Client ID、Client Secret 换取 access_token，再调用用户信息接口。',
]

const scopes = [
  { name: 'openid', desc: '基础身份标识，建议所有应用默认申请。' },
  { name: 'profile', desc: '用户基础资料，例如用户名、头像等。' },
  { name: 'email', desc: '用户邮箱及邮箱验证状态。' },
]
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="对接文档">
      <template #actions>
        <NButton @click="$router.push('/user/applications')">管理应用</NButton>
        <NButton type="primary" @click="$router.push('/user/applications')">新建应用</NButton>
      </template>
    </PageHeader>

    <section class="panel-card p-6">
      <div class="page-header">
        <div>
          <p class="eyebrow">OAuth2 / OIDC 接入</p>
          <h2 class="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">标准授权码流程</h2>
          <p class="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
            业务系统只需要完成应用登记、授权跳转、回调换 token 三步，即可接入一证通行。
          </p>
        </div>
        <StatusTag tone="info" label="推荐" />
      </div>

      <div class="mt-6 grid gap-4">
        <div v-for="(step, index) in steps" :key="step" class="doc-step">
          <span>{{ index + 1 }}</span>
          <p>{{ step }}</p>
        </div>
      </div>
    </section>

    <div class="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
      <section class="panel-card p-6">
        <p class="eyebrow">接口地址</p>
        <div class="mt-5 space-y-3">
          <div v-for="item in endpoints" :key="item.name" class="panel-muted p-4">
            <p class="text-sm font-semibold text-[var(--text-primary)]">{{ item.name }}</p>
            <code class="mt-2 block break-all font-mono text-xs leading-6 text-[var(--text-secondary)]">{{ item.value }}</code>
          </div>
        </div>
      </section>

      <section class="panel-card p-6">
        <p class="eyebrow">Scope 说明</p>
        <div class="mt-5 space-y-3">
          <div v-for="scope in scopes" :key="scope.name" class="panel-muted p-4">
            <div class="flex items-center gap-2">
              <StatusTag tone="info" :label="scope.name" />
              <span class="text-sm font-semibold text-[var(--text-primary)]">权限范围</span>
            </div>
            <p class="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{{ scope.desc }}</p>
          </div>
        </div>
      </section>
    </div>

    <section class="panel-card p-6">
      <p class="eyebrow">前端跳转示例</p>
      <pre class="metadata-pre mt-4">const params = new URLSearchParams({
  client_id: '你的 Client ID',
  redirect_uri: 'https://你的系统/oauth/callback',
  scope: 'openid profile email',
  state: crypto.randomUUID(),
})

window.location.href = `${origin}/login?${params.toString()}`</pre>
    </section>

    <section class="panel-card p-6">
      <p class="eyebrow">后端换取令牌</p>
      <pre class="metadata-pre mt-4">POST /oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=回调中收到的 code
&client_id=你的 Client ID
&client_secret=你的 Client Secret
&redirect_uri=登记过的回调地址</pre>
    </section>
  </div>
</template>

<style scoped>
.doc-step {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  border: 1px solid var(--border-primary);
  border-radius: 1.25rem;
  background: var(--surface-muted);
  padding: 16px;
}

.doc-step span {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

.doc-step p {
  margin: 3px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}
</style>
