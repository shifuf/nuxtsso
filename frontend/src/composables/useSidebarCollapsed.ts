import { ref } from 'vue'

const STORAGE_KEY = 'nexus-sso-sidebar-collapsed'
const collapsed = ref(false)

const initialize = () => {
  if (typeof window === 'undefined') return
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'true') {
    collapsed.value = true
  }
}

let initialized = false

export const useSidebarCollapsed = () => {
  if (!initialized) {
    initialize()
    initialized = true
  }

  const setCollapsed = (value: boolean) => {
    collapsed.value = value
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    }
  }

  const toggleCollapsed = () => {
    setCollapsed(!collapsed.value)
  }

  return {
    collapsed,
    setCollapsed,
    toggleCollapsed,
  }
}
