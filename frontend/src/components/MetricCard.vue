<script setup lang="ts">
import StatusTag from './StatusTag.vue'

withDefaults(
  defineProps<{
    label: string
    value: string
    caption?: string
    trend?: string
    tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral'
  }>(),
  {
    caption: '',
    trend: '',
    tone: 'neutral',
  }
)
</script>

<template>
  <div class="panel-card metric-card">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="eyebrow">{{ label }}</p>
        <p class="metric-value mt-3">{{ value }}</p>
      </div>
      <StatusTag v-if="trend" :tone="tone" :label="trend" />
    </div>
    <p v-if="caption" class="metric-caption">{{ caption }}</p>
  </div>
</template>
