<script setup lang="ts">
import { computed } from 'vue'
import {
  NConfigProvider,
  darkTheme,
  zhCN,
  dateZhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'
import { useTheme } from './composables/useTheme'

const { resolvedTheme } = useTheme()

const themeOverride = computed(() => (resolvedTheme.value === 'dark' ? darkTheme : null))

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

const themeOverrides = computed<GlobalThemeOverrides>(() =>
  resolvedTheme.value === 'dark' ? darkOverrides : lightOverrides,
)
</script>

<template>
  <NConfigProvider
    :theme="themeOverride"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    inline-theme-disabled
  >
    <router-view />
  </NConfigProvider>
</template>
