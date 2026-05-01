<script setup lang="ts">
const nodeMetrics = [
  { label: 'Compute Power', value: '42.8 TFlops', usage: 64 },
  { label: 'Memory Commit', value: '1.2 PB', usage: 42 },
  { label: 'Network Ingress', value: '48.2 Gbps', usage: 12 },
  { label: 'Network Egress', value: '12.4 Gbps', usage: 8 },
]

const computeInstances = [
  { id: 'inst-9402', type: 't4g.xlarge', zone: 'us-east-1a', ip: '10.0.42.102', status: 'RUNNING', cpu: '12%' },
  { id: 'inst-8812', type: 'm6i.2xlarge', zone: 'us-east-1b', ip: '10.0.42.55', status: 'RUNNING', cpu: '48%' },
  { id: 'inst-7710', type: 'c6g.large', zone: 'us-east-1a', ip: '10.0.42.12', status: 'PENDING', cpu: '0%' },
  { id: 'inst-6612', type: 'r6g.xlarge', zone: 'us-east-1c', ip: '10.0.42.99', status: 'RUNNING', cpu: '88%' },
]
</script>

<template>
  <div class="space-y-6">
    <!-- Metric Fabric -->
    <div class="data-grid grid-cols-4 shadow-sm">
      <div v-for="m in nodeMetrics" :key="m.label" class="data-cell group">
        <div class="flex justify-between items-start mb-4">
          <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ m.label }}</span>
          <t-icon name="chart-line" size="14px" class="text-gray-200 group-hover:text-[#60a5fa] transition-colors" />
        </div>
        <div class="text-xl font-black text-gray-900 tracking-tighter mb-4">{{ m.value }}</div>
        <div class="h-0.5 w-full bg-gray-50 overflow-hidden">
          <div class="h-full bg-[#60a5fa]" :style="{ width: m.usage + '%' }"></div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-6">
      <!-- Instance Registry -->
      <div class="col-span-2 a-panel flex flex-col">
        <div class="a-panel-header">
          <span class="a-panel-title">Active Compute Registry</span>
          <div class="flex items-center gap-4">
            <span class="text-[9px] font-black text-gray-400 uppercase">Auto-Scale: Enabled</span>
            <div class="h-4 w-px bg-gray-100"></div>
            <button class="text-[#60a5fa] text-[10px] font-black uppercase">Batch Actions</button>
          </div>
        </div>
        <div class="flex-1">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-[10px] font-black text-gray-400 uppercase tracking-[0.1em] border-b border-gray-100 bg-gray-50/30">
                <th class="py-2.5 px-4">Instance_ID</th>
                <th class="py-2.5 px-4">Type_Class</th>
                <th class="py-2.5 px-4">Zone</th>
                <th class="py-2.5 px-4">Private_IP</th>
                <th class="py-2.5 px-4">CPU_Load</th>
                <th class="py-2.5 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="inst in computeInstances" :key="inst.id" class="hover:bg-blue-50/20 transition-colors">
                <td class="py-3 px-4 font-black text-gray-800 text-[11px] tracking-tight">{{ inst.id }}</td>
                <td class="py-3 px-4 text-gray-400 font-bold text-[10px] uppercase">{{ inst.type }}</td>
                <td class="py-3 px-4 text-gray-500 font-bold text-[10px] uppercase">{{ inst.zone }}</td>
                <td class="py-3 px-4 font-mono text-xs text-gray-400">{{ inst.ip }}</td>
                <td class="py-3 px-4">
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] font-black text-gray-700 w-8">{{ inst.cpu }}</span>
                    <div class="flex-1 h-1 bg-gray-50">
                      <div class="h-full bg-[#60a5fa]" :style="{ width: inst.cpu }"></div>
                    </div>
                  </div>
                </td>
                <td class="py-3 px-4 text-right">
                  <span :class="inst.status === 'RUNNING' ? 'text-[#60a5fa]' : 'text-amber-500'" class="status-dot">
                    <span class="h-1 w-1 rounded-full bg-current"></span>
                    {{ inst.status }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Security Intelligence -->
      <div class="space-y-6">
        <div class="a-panel">
          <div class="a-panel-header">
            <span class="a-panel-title">Threat Monitoring</span>
          </div>
          <div class="p-4">
            <div class="flex items-end gap-2 mb-6">
              <span class="text-3xl font-black text-gray-900 leading-none">0.02%</span>
              <span class="text-[10px] font-black text-[#60a5fa] uppercase tracking-widest pb-0.5">Packet Loss</span>
            </div>
            <div class="space-y-4">
              <div v-for="i in 3" :key="i" class="flex justify-between items-center p-2 border-l-2 border-l-[#60a5fa] bg-blue-50/30">
                <div>
                  <p class="text-[10px] font-black text-gray-700 uppercase">Intrusion Alert: CIDR_{{ i }}</p>
                  <p class="text-[9px] text-gray-400 font-bold uppercase mt-0.5">Level: Info / Source: External</p>
                </div>
                <button class="h-5 w-5 bg-white border border-blue-100 flex items-center justify-center text-[#60a5fa]">
                  <t-icon name="chevron-right" size="14px" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="a-panel bg-[#60a5fa] border-none p-5 text-white">
          <div class="flex items-center gap-3 mb-6">
            <div class="h-8 w-8 bg-white/20 flex items-center justify-center">
              <t-icon name="shield-check" size="20px" />
            </div>
            <h3 class="text-xs font-black uppercase tracking-[0.2em]">Global Firewall</h3>
          </div>
          <div class="space-y-3">
            <div class="flex justify-between text-[10px] font-bold uppercase tracking-widest opacity-80">
              <span>Rule Compliance</span>
              <span>100%</span>
            </div>
            <div class="h-1 bg-white/20">
              <div class="h-full bg-white" style="width: 100%"></div>
            </div>
            <p class="text-[9px] font-bold uppercase tracking-tight mt-4 opacity-70 leading-relaxed">
              Active Security Profile: L4_DEEP_INSPECTION_V2. 
              All ingress traffic is analyzed via Aether AI Cluster.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
