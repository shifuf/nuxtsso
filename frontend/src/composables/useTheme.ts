import { onMounted, ref } from 'vue'

type ThemeMode = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'nexus-sso-theme-mode'
const theme = ref<ThemeMode>('system')
const resolvedTheme = ref<ResolvedTheme>('light')
let initialized = false

const getSystemTheme = (): ResolvedTheme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

const applyTheme = (mode: ThemeMode) => {
  if (typeof window === 'undefined') return

  const next = mode === 'system' ? getSystemTheme() : mode
  const root = document.documentElement
  const current = root.getAttribute('data-app-theme')

  resolvedTheme.value = next
  root.removeAttribute('theme-mode')
  if (current !== next) {
    root.setAttribute('data-app-theme', next)
  }
  window.localStorage.setItem(STORAGE_KEY, mode)
}

const initialize = () => {
  if (typeof window === 'undefined' || initialized) return

  const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    theme.value = stored
  }

  applyTheme(theme.value)

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', () => {
    if (theme.value === 'system') applyTheme('system')
  })

  initialized = true
}

export const useTheme = () => {
  onMounted(() => {
    initialize()
  })

  const setTheme = (mode: ThemeMode) => {
    if (theme.value === mode) return
    theme.value = mode
    applyTheme(mode)
  }

  return {
    theme,
    resolvedTheme,
    setTheme,
  }
}
