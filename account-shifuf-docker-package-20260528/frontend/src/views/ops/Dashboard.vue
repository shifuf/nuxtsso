<script setup lang="ts">
import { NButton } from 'naive-ui'
import Icon from '../../components/Icon.vue'

const clusterMetrics = [
  { label: 'CPU Utilization', value: '42.8%', status: 'ok', trend: '+1.2%' },
  { label: 'Memory Buffer', value: '18.4 GB', status: 'ok', trend: '-0.5%' },
  { label: 'Active Requests', value: '1.2k/s', status: 'warn', trend: '+18.4%' },
  { label: 'Network I/O', value: '482 MB/s', status: 'ok', trend: '+4.1%' },
]

const serviceList = [
  { name: 'auth-gateway-v2', version: '2.4.1-stable', zone: 'Zone-A', traffic: '42%', status: 'HEALTHY' },
  { name: 'identity-provider-core', version: '1.0.8-prod', zone: 'Zone-B', traffic: '18%', status: 'HEALTHY' },
  { name: 'audit-log-pipeline', version: '0.9.4-alpha', zone: 'Zone-A', traffic: '12%', status: 'DEGRADED' },
  { name: 'session-store-cluster', version: '5.2.0-rc', zone: 'Zone-C', traffic: '28%', status: 'HEALTHY' },
]
</script>

<template>
  <div class="space-y-6">
    <!-- Infrastructure Health Grid -->
    <div class="grid grid-cols-4 gap-6">
      <div v-for="m in clusterMetrics" :key="m.label" class="l-box p-4 border-l-4"
        :class="m.status === 'warn' ? 'border-l-amber-500' : 'border-l-slate-200'">
        <div class="flex justify-between items-start mb-2">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">{{ m.label }}</span>
          <span class="text-[9px] font-bold" :class="m.trend.startsWith('+') ? 'text-emerald-600' : 'text-slate-400'">{{ m.trend }}</span>
        </div>
        <div class="text-2xl font-black text-slate-800 tracking-tighter">{{ m.value }}</div>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-6">
      <!-- Primary Traffic Controller -->
      <div class="col-span-2 l-box">
        <div class="l-box-header">
          <span class="l-box-title">Active Service Registry</span>
          <div class="flex gap-2">
            <NButton size="small">Refresh Data</NButton>
            <NButton size="small">Export Schema</NButton>
          </div>
        </div>
        <div class="p-0">
          <table class="l-table">
            <thead>
              <tr>
                <th>Service Descriptor</th>
                <th>Release Version</th>
                <th>Availability Zone</th>
                <th>Load Distribution</th>
                <th class="text-right">Operational State</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="svc in serviceList" :key="svc.name" class="hover:bg-slate-50/50">
                <td class="font-bold text-slate-700 tracking-tight">{{ svc.name }}</td>
                <td class="font-mono text-[10px] text-slate-400 font-bold uppercase">{{ svc.version }}</td>
                <td class="text-slate-500 font-bold text-[10px] uppercase">{{ svc.zone }}</td>
                <td>
                  <div class="flex items-center gap-3">
                    <div class="flex-1 h-1 bg-slate-100 overflow-hidden">
                      <div class="h-full bg-slate-400" :style="{ width: svc.traffic }"></div>
                    </div>
                    <span class="text-[10px] font-black text-slate-400 w-8">{{ svc.traffic }}</span>
                  </div>
                </td>
                <td class="text-right">
                  <span :class="svc.status === 'HEALTHY' ? 'l-tag-ok' : 'l-tag-warn'" class="l-tag">
                    {{ svc.status }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Policy Registry -->
      <div class="l-box flex flex-col">
        <div class="l-box-header">
          <span class="l-box-title">Security Policies</span>
        </div>
        <div class="flex-1 p-4 space-y-4">
          <div v-for="i in 3" :key="i" class="p-3 border border-slate-100 bg-slate-50/30">
            <div class="flex justify-between items-center mb-2">
              <span class="text-[11px] font-black text-slate-700 uppercase tracking-tight">
                {{ ['Rate Limiting: API_V2', 'CIDR Block: Restricted', 'MFA Enforcement'][i-1] }}
              </span>
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </div>
            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Last Modified: 2026-04-27 10:24:12</p>
          </div>

          <div class="pt-4 mt-4 border-t border-slate-100">
            <NButton block dashed class="!border-dashed !border-slate-300">
              <template #icon><Icon name="add" /></template>
              Append Security Rule
            </NButton>
          </div>
        </div>
        <div class="p-4 bg-slate-900 text-white border-t border-slate-800">
          <div class="flex items-center justify-between mb-4">
            <span class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Global Protection</span>
            <span class="text-[10px] font-black text-emerald-500">ENABLED</span>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="p-2 border border-slate-800 bg-slate-800/50">
              <p class="text-[9px] font-black text-slate-500 uppercase mb-1">Threats Blocked</p>
              <p class="text-lg font-black tracking-tighter">14,204</p>
            </div>
            <div class="p-2 border border-slate-800 bg-slate-800/50">
              <p class="text-[9px] font-black text-slate-500 uppercase mb-1">DDoS Filter</p>
              <p class="text-lg font-black tracking-tighter">Active</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
