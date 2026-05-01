<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    contrast?: boolean
  }>(),
  {
    subtitle: '',
    contrast: false,
  },
)
</script>

<template>
  <div class="brand-mark">
    <div class="brand-mark__logo">NX</div>
    <div class="min-w-0">
      <p
        class="brand-mark__title truncate"
        :style="{ color: props.contrast ? 'var(--text-contrast)' : 'var(--text-primary)' }"
      >
        {{ props.title }}
      </p>
      <p
        v-if="props.subtitle"
        class="brand-mark__copy truncate"
        :style="{ color: props.contrast ? 'rgba(226,232,240,0.72)' : 'var(--text-muted)' }"
      >
        {{ props.subtitle }}
      </p>
    </div>
  </div>
</template>
