<script setup lang="ts">
import { computed, h, type Component } from 'vue'
import { NIcon } from 'naive-ui'
import {
  ShieldLock,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  Logout,
  Loader,
  CircleCheck,
  ArrowsLeftRight,
  Copy,
  AppWindow,
  Cloud,
  ShoppingCart,
  World,
  Server,
  DeviceDesktop,
  UserPlus,
  Key,
  Code,
  Link,
  ChartLine,
  ShieldCheck,
  AlertCircle,
  Plus,
  Edit,
  Dots,
  Dashboard,
  CloudUpload,
  Users,
  FileText,
  ListDetails,
  Settings,
  User,
  Menu2,
  Bookmark,
  Refresh,
} from '@vicons/tabler'

const props = withDefaults(
  defineProps<{
    name: string
    size?: string | number
  }>(),
  {
    size: '16px',
  },
)

const ICON_MAP: Record<string, Component> = {
  secured: ShieldLock,
  moon: Moon,
  sunny: Sun,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'menu-fold': Menu2,
  logout: Logout,
  loading: Loader,
  'check-circle-filled': CircleCheck,
  swap: ArrowsLeftRight,
  copy: Copy,
  app: AppWindow,
  cloud: Cloud,
  shop: ShoppingCart,
  internet: World,
  server: Server,
  computer: DeviceDesktop,
  'user-add': UserPlus,
  key: Key,
  code: Code,
  link: Link,
  'chart-line': ChartLine,
  'shield-check': ShieldCheck,
  'error-circle-filled': AlertCircle,
  add: Plus,
  edit: Edit,
  more: Dots,
  dashboard: Dashboard,
  'cloud-upload': CloudUpload,
  usergroup: Users,
  'file-paste': FileText,
  'order-adjustment-column': ListDetails,
  setting: Settings,
  user: User,
  'component-breadcrumb': Bookmark,
  refresh: Refresh,
}

function resolveSizeNumber(value: string | number): number {
  if (typeof value === 'number') return value
  const match = String(value).match(/^(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 16
}

const Resolved = computed<Component>(() => ICON_MAP[props.name] ?? AppWindow)

const renderIcon = () => h(Resolved.value)
</script>

<template>
  <NIcon :size="resolveSizeNumber(props.size)" :style="{ verticalAlign: 'middle' }">
    <component :is="renderIcon" />
  </NIcon>
</template>
