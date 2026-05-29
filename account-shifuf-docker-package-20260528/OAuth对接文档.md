# OAuth 对接文档

认证中心地址：

```text
https://account.shifuf.com
```

本文档用于第三方业务系统接入一证通行统一登录。

## 1. 接入流程

标准流程如下：

```text
业务系统创建应用
业务系统跳转用户到统一登录页
用户登录并确认授权
认证中心回跳业务系统 redirect_uri
业务系统后端使用 code 换取 token
业务系统使用 access_token 获取用户信息
```

当前支持 OAuth2 授权码模式，适合有后端服务的 Web 应用、管理后台、内部系统。

## 2. 创建接入应用

管理员登录：

```text
https://account.shifuf.com/login
```

进入应用管理：

```text
https://account.shifuf.com/user/applications
```

新建应用时填写：

```text
应用名称：业务系统名称
应用描述：业务系统用途
回调地址：业务系统用于接收 code 的完整 URL
Scope 权限：openid、profile、email
注册策略：按业务需要选择是否允许用户从授权链路注册
```

回调地址示例：

```text
https://your-app.example.com/oauth/callback
```

创建后会得到：

```text
Client ID
Client Secret
```

`Client Secret` 只能保存在业务系统后端，不能放在前端页面、小程序端、App 客户端或公开仓库中。

## 3. 授权登录地址

业务系统将用户跳转到：

```text
https://account.shifuf.com/login?client_id=CLIENT_ID&redirect_uri=REDIRECT_URI&scope=openid%20profile%20email&state=STATE
```

参数说明：

```text
client_id：应用的 Client ID，必填
redirect_uri：后台登记过的回调地址，必填，必须完全一致
scope：申请的权限范围，多个值用空格分隔
state：业务系统生成的随机字符串，建议必填，用于防止 CSRF
nonce：可选，使用 openid 时可用于 ID Token 校验
```

前端跳转示例：

```js
const params = new URLSearchParams({
  client_id: '你的 Client ID',
  redirect_uri: 'https://your-app.example.com/oauth/callback',
  scope: 'openid profile email',
  state: crypto.randomUUID(),
})

window.location.href = `https://account.shifuf.com/login?${params.toString()}`
```

## 4. 授权回调

用户完成登录和授权后，认证中心会回跳：

```text
https://your-app.example.com/oauth/callback?code=AUTH_CODE&state=STATE
```

业务系统必须校验：

```text
state 是否与发起授权时保存的一致
code 是否存在
是否存在 error 参数
```

用户拒绝授权时可能返回：

```text
https://your-app.example.com/oauth/callback?error=access_denied&state=STATE
```

## 5. 使用 code 换取 Token

该步骤必须在业务系统后端完成。

请求地址：

```http
POST https://account.shifuf.com/oauth2/token
Content-Type: application/x-www-form-urlencoded
```

请求参数：

```text
grant_type=authorization_code
client_id=CLIENT_ID
client_secret=CLIENT_SECRET
code=AUTH_CODE
redirect_uri=https://your-app.example.com/oauth/callback
```

curl 示例：

```bash
curl -X POST "https://account.shifuf.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "client_id=CLIENT_ID" \
  --data-urlencode "client_secret=CLIENT_SECRET" \
  --data-urlencode "code=AUTH_CODE" \
  --data-urlencode "redirect_uri=https://your-app.example.com/oauth/callback"
```

返回示例：

```json
{
  "access_token": "ACCESS_TOKEN",
  "refresh_token": "REFRESH_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email",
  "id_token": "ID_TOKEN"
}
```

字段说明：

```text
access_token：访问用户信息接口的令牌
refresh_token：刷新令牌
token_type：固定为 Bearer
expires_in：access_token 有效期，单位秒
scope：实际授权的权限范围
id_token：申请 openid 时返回
```

## 6. 获取用户信息

请求地址：

```http
GET https://account.shifuf.com/oauth2/userinfo
Authorization: Bearer ACCESS_TOKEN
```

curl 示例：

```bash
curl "https://account.shifuf.com/oauth2/userinfo" \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

返回示例：

```json
{
  "sub": "USER_ID",
  "name": "username",
  "email": "user@example.com",
  "email_verified": true,
  "picture": null
}
```

建议业务系统使用 `sub` 作为认证中心用户唯一 ID。

## 7. 刷新 Token

请求地址：

```http
POST https://account.shifuf.com/oauth2/token
Content-Type: application/x-www-form-urlencoded
```

请求参数：

```text
grant_type=refresh_token
client_id=CLIENT_ID
client_secret=CLIENT_SECRET
refresh_token=REFRESH_TOKEN
```

curl 示例：

```bash
curl -X POST "https://account.shifuf.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "client_id=CLIENT_ID" \
  --data-urlencode "client_secret=CLIENT_SECRET" \
  --data-urlencode "refresh_token=REFRESH_TOKEN"
```

## 8. 权限范围

当前建议使用：

```text
openid：基础身份标识，会返回 id_token
profile：用户基础资料
email：用户邮箱和邮箱验证状态
```

应用后台配置了哪些 Scope，业务系统授权时才能申请哪些 Scope。

## 9. OIDC 发现地址

配置发现地址：

```text
https://account.shifuf.com/.well-known/openid-configuration
```

JWKS 公钥地址：

```text
https://account.shifuf.com/oauth2/jwks
```

注意：本系统真实用户授权入口使用：

```text
https://account.shifuf.com/login
```

不要把用户直接跳转到 `/oauth2/authorize`，该接口在当前系统中用于授权上下文校验。

## 10. Node.js 后端换 Token 示例

```js
async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.SSO_CLIENT_ID,
    client_secret: process.env.SSO_CLIENT_SECRET,
    code,
    redirect_uri: 'https://your-app.example.com/oauth/callback',
  })

  const response = await fetch('https://account.shifuf.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }

  return response.json()
}
```

获取用户信息：

```js
async function getUserInfo(accessToken) {
  const response = await fetch('https://account.shifuf.com/oauth2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Userinfo failed: ${response.status}`)
  }

  return response.json()
}
```

## 11. 常见错误

回调地址不在允许范围内：

```text
redirect_uri 必须与应用后台登记地址完全一致，包括 https、域名、路径和末尾斜杠。
```

Client ID 和密钥不匹配：

```text
检查 client_id、client_secret 是否来自同一个应用，是否重置过密钥。
```

授权码无效：

```text
code 只能使用一次，且有效期较短。不要在前端换 token，必须由后端立即换取。
```

不支持的权限范围：

```text
检查应用后台 Scope 是否包含本次请求的 scope。
```

应用已被禁用：

```text
联系管理员在应用接入页面启用该应用。
```

