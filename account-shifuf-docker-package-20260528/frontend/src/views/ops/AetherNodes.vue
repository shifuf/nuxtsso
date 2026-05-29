<script setup lang="ts">
import { NCheckbox } from 'naive-ui'
import Icon from '../../components/Icon.vue'

const nodes = Array.from({ length: 8 }).map((_, i) => ({
  id: `NODE-0x${Math.random().toString(16).slice(2, 6).toUpperCase()}`,
  ip: `10.128.0.${10 + i}`,
  status: i % 4 === 0 ? 'MAINTENANCE' : 'ACTIVE',
  load: Math.floor(Math.random() * 100),
  uptime: `${Math.floor(Math.random() * 100)}d ${Math.floor(Math.random() * 24)}h`
}))
</script>

<template>
  <div class="space-y-4">
    <!-- 操作工具栏 -->
    <div class="a-panel p-3 flex justify-between items-center bg-gray-50/50">
      <div class="flex gap-4">
        <input class="ops-input w-80" placeholder="Filter nodes by ID, IP, or Label..." />
        <select class="ops-input w-32"><option>All Zones</option></select>
      </div>
      <div class="flex gap-2">
        <button class="btn-aether-outline">Batch Reboot</button>
        <button class="btn-aether">Add Compute Node</button>
      </div>
    </div>

    <!-- 高密度列表 -->
    <div class="a-panel overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 bg-gray-50/80">
            <th class="py-3 px-4 w-10"><NCheckbox /></th>
            <th class="py-3 px-4">Node_Identifier</th>
            <th class="py-3 px-4">Interface_IP</th>
            <th class="py-3 px-4">System_Uptime</th>
            <th class="py-3 px-4">Resource_Utilization</th>
            <th class="py-3 px-4 text-right">State</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="node in nodes" :key="node.id" class="hover:bg-blue-50/30 group">
            <td class="py-3 px-4"><NCheckbox /></td>
            <td class="py-3 px-4 font-black text-gray-800 text-[11px] tracking-tight">{{ node.id }}</td>
            <td class="py-3 px-4 font-mono text-gray-400 font-bold">{{ node.ip }}</td>
            <td class="py-3 px-4 text-gray-500 font-bold uppercase text-[10px] tracking-tighter">{{ node.uptime }}</td>
            <td class="py-3 px-4">
              <div class="flex items-center gap-3 w-48">
                <div class="flex-1 h-1 bg-gray-100">
                  <div class="h-full bg-[#60a5fa]" :style="{ width: node.load + '%' }"></div>
                </div>
                <span class="text-[10px] font-black text-gray-400 w-8">{{ node.load }}%</span>
              </div>
            </td>
            <td class="py-3 px-4 text-right">
              <span :class="node.status === 'ACTIVE' ? 'text-[#60a5fa]' : 'text-amber-500'" class="status-dot">
                <span class="h-1 w-1 rounded-full bg-current"></span>
                {{ node.status }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 底部翻页 -->
    <div class="flex justify-between items-center px-2">
      <span class="text-[10px] font-bold text-gray-400 uppercase">Showing 1-20 of 482 nodes</span>
      <div class="flex border border-gray-200 bg-white">
        <button class="h-8 w-8 flex items-center justify-center border-r border-gray-100 hover:bg-gray-50 text-gray-400"><Icon name="chevron-left" /></button>
        <button class="h-8 w-8 flex items-center justify-center border-r border-gray-100 bg-blue-50 text-[#60a5fa] font-black text-[10px]">1</button>
        <button class="h-8 w-8 flex items-center justify-center border-r border-gray-100 hover:bg-gray-50 text-gray-500 font-bold text-[10px]">2</button>
        <button class="h-8 w-8 flex items-center justify-center border-r border-gray-100 hover:bg-gray-50 text-gray-500 font-bold text-[10px]">3</button>
        <button class="h-8 w-8 flex items-center justify-center hover:bg-gray-50 text-gray-400"><Icon name="chevron-right" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ops-input {
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  padding: 6px 10px;
  background: var(--surface-primary);
  color: var(--text-primary);
  font-size: 13px;
}
</style>
