export const DEFAULT_APPLICATION_SCOPES = ['openid', 'profile', 'email'] as const

export const APPLICATION_SCOPE_OPTIONS = [
  { label: '唯一标识', value: 'openid' },
  { label: '用户资料', value: 'profile' },
  { label: '邮箱', value: 'email' },
]

const SCOPE_LABELS = new Map(
  APPLICATION_SCOPE_OPTIONS.map((item) => [item.value, item.label]),
)

export function scopeLabel(scope: string) {
  return SCOPE_LABELS.get(scope) ?? scope
}

export function defaultApplicationScopes() {
  return [...DEFAULT_APPLICATION_SCOPES]
}

export function normalizeApplicationScopes(scopes?: string[]) {
  const values = scopes?.length ? scopes : defaultApplicationScopes()
  return Array.from(new Set(values.map((scope) => scope.trim()).filter(Boolean)))
}
