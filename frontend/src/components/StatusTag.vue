<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral'
    label: string
  }>(),
  {
    tone: 'neutral',
  },
)

const toneClass = computed(() => {
  switch (props.tone) {
    case 'info':
      return 'tag-info'
    case 'success':
      return 'tag-success'
    case 'warning':
      return 'tag-warning'
    case 'danger':
      return 'tag-danger'
    default:
      return 'tag-neutral'
  }
})
</script>

<template>
  <span :class="['tag', toneClass]">{{ label }}</span>
</template>
