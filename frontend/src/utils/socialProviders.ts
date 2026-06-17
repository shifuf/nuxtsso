import type { SocialProviderConfig } from '../types/api'

export const WECHAT_PROVIDER_NAMES = ['wechat', 'wechat-aggregated', 'wechat-mini'] as const

type ProviderLike = {
  name: string
  type?: string
  enabled: boolean
}

export function isWechatProviderName(name?: string | null) {
  return Boolean(name && WECHAT_PROVIDER_NAMES.includes(name as (typeof WECHAT_PROVIDER_NAMES)[number]))
}

export function getWechatProviderNameByType(type?: string | null) {
  if (type === 'aggregated') return 'wechat-aggregated'
  if (type === 'wechat-mini') return 'wechat-mini'
  return 'wechat'
}

export function getWechatDisplayTypeLabel(type?: string | null) {
  if (type === 'aggregated') return '聚合平台'
  if (type === 'wechat-mini') return '自建小程序'
  return '官方直连'
}

export function resolveRuntimeProviderName(provider: { name: string; type?: string }) {
  if (provider.name !== 'wechat') return provider.name
  return getWechatProviderNameByType(provider.type)
}

export function normalizeWechatProviderNames(names: string[]) {
  const result = new Set<string>()
  let hasWechat = false

  for (const name of names) {
    if (isWechatProviderName(name)) {
      hasWechat = true
    } else {
      result.add(name)
    }
  }

  if (hasWechat) result.add('wechat')
  return [...result]
}

export function foldWechatProviders<T extends ProviderLike>(providers: T[]) {
  const wechatProviders = providers.filter(provider => isWechatProviderName(provider.name))
  if (wechatProviders.length === 0) return providers

  const enabledWechat = wechatProviders.find(provider => provider.enabled)
  const primaryWechat =
    enabledWechat ??
    wechatProviders.find(provider => provider.name === 'wechat') ??
    wechatProviders[0]
  const foldedWechat = {
    ...primaryWechat,
    name: 'wechat',
    enabled: wechatProviders.some(provider => provider.enabled),
    type: enabledWechat?.type ?? primaryWechat.type,
  }
  const folded: T[] = []
  let insertedWechat = false

  for (const provider of providers) {
    if (isWechatProviderName(provider.name)) {
      if (!insertedWechat) {
        folded.push(foldedWechat as T)
        insertedWechat = true
      }
      continue
    }
    folded.push(provider)
  }

  return folded
}

export function isProviderBound(provider: Pick<SocialProviderConfig, 'name'>, boundProviders: Set<string>) {
  if (!isWechatProviderName(provider.name)) return boundProviders.has(provider.name)
  return WECHAT_PROVIDER_NAMES.some(name => boundProviders.has(name))
}
