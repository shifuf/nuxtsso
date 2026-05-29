<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow?: string
    title: string
    description?: string
  }>(),
  {
    eyebrow: '',
    description: '',
  },
)
</script>

<template>
  <Teleport v-if="$slots.actions" to="#console-route-actions">
    <slot name="actions" />
  </Teleport>
</template>
