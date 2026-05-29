<script setup lang="ts">
import { useTheme } from '../composables/useTheme'

const { theme, setTheme } = useTheme()

const options = [
  { value: 'light' as const, label: '浅色' },
  { value: 'dark' as const, label: '深色' },
  { value: 'system' as const, label: '跟随系统' },
]
</script>

<template>
  <div class="theme-switch" role="group" aria-label="主题切换">
    <button
      v-for="option in options"
      :key="option.value"
      :class="{ 'is-active': theme === option.value }"
      @click="setTheme(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
