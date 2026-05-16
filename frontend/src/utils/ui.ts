import { darkTheme, createDiscreteApi, type GlobalThemeOverrides } from 'naive-ui'

const THEME_STORAGE_KEY = 'nexus-sso-theme-mode'

function resolveTheme() {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  const next = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode
  return next === 'dark' ? darkTheme : null
}

const lightOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#3258FF',
    primaryColorHover: '#2643FF',
    primaryColorPressed: '#1F36FF',
    primaryColorSuppl: '#4D7CFF',
    infoColor: '#3258FF',
    infoColorHover: '#2643FF',
    infoColorPressed: '#1F36FF',
    infoColorSuppl: '#4D7CFF',
    successColor: '#3258FF',
    successColorHover: '#2643FF',
    successColorPressed: '#1F36FF',
    successColorSuppl: '#4D7CFF',
    warningColor: '#F59E0B',
    warningColorHover: '#D97706',
    warningColorPressed: '#B45309',
    warningColorSuppl: '#FBBF24',
    errorColor: '#F43F5E',
    errorColorHover: '#E11D48',
    errorColorPressed: '#BE123C',
    errorColorSuppl: '#FB7185',
  },
}

const darkOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#4D7CFF',
    primaryColorHover: '#6A89FF',
    primaryColorPressed: '#93B0FF',
    primaryColorSuppl: '#6A89FF',
    infoColor: '#4D7CFF',
    infoColorHover: '#6A89FF',
    infoColorPressed: '#93B0FF',
    infoColorSuppl: '#6A89FF',
    successColor: '#4D7CFF',
    successColorHover: '#6A89FF',
    successColorPressed: '#93B0FF',
    successColorSuppl: '#6A89FF',
    warningColor: '#FBBF24',
    warningColorHover: '#FCD34D',
    warningColorPressed: '#F59E0B',
    warningColorSuppl: '#FBBF24',
    errorColor: '#FB7185',
    errorColorHover: '#FDA4AF',
    errorColorPressed: '#F43F5E',
    errorColorSuppl: '#FB7185',
  },
}

const isDark = resolveTheme() === darkTheme

const { message, dialog, notification } = createDiscreteApi(
  ['message', 'dialog', 'notification'],
  {
    configProviderProps: {
      theme: isDark ? darkTheme : null,
      themeOverrides: isDark ? darkOverrides : lightOverrides,
      inlineThemeDisabled: true,
    },
  },
)

export interface ConfirmOptions {
  header?: string
  body: string
  confirmBtn?: string
  cancelBtn?: string
  theme?: 'danger' | 'warning' | 'primary' | 'default'
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void | Promise<void>
}

export const MessagePlugin = {
  success: (content: string) => message.success(content),
  warning: (content: string) => message.warning(content),
  error: (content: string) => message.error(content),
  info: (content: string) => message.info(content),
}

export const DialogPlugin = {
  confirm(options: ConfirmOptions) {
    const variant = options.theme === 'danger' ? 'error' : options.theme === 'warning' ? 'warning' : 'info'
    const instance = dialog[variant]({
      title: options.header ?? '提示',
      content: options.body,
      positiveText: options.confirmBtn ?? '确认',
      negativeText: options.cancelBtn ?? '取消',
      onPositiveClick: async () => {
        if (options.onConfirm) {
          await options.onConfirm()
        }
      },
      onNegativeClick: async () => {
        if (options.onCancel) {
          await options.onCancel()
        }
      },
    })
    return {
      hide: () => instance.destroy(),
    }
  },
}

export { message, dialog, notification }
