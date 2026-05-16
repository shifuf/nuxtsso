<script setup lang="ts">
import Icon from '../../components/Icon.vue'

const highlights = [
  { label: 'Active Clusters', value: '12', trend: '+2', icon: 'dashboard', featured: true },
  { label: 'Network Latency', value: '14ms', trend: '-2ms', icon: 'internet' },
  { label: 'Security Score', value: '98', trend: 'A+', icon: 'shield-check' },
  { label: 'Cloud Uptime', value: '99.9%', trend: 'Stable', icon: 'cloud-upload' },
]

const recentActivities = [
  { id: 'DP-942', service: 'Auth_Gateway_v2', status: 'COMPLETE', time: '2m ago', type: 'Blue/Green' },
  { id: 'DP-941', service: 'Redis_Cluster_Prod', status: 'IN_PROGRESS', time: 'Just now', type: 'Rolling' },
  { id: 'DP-940', service: 'Legacy_API_Node', status: 'FAILED', time: '14m ago', type: 'Hotfix' },
]
</script>

<template>
  <div class="space-y-20">
    <!-- Highlight Grid -->
    <div class="grid grid-cols-4 gap-10">
      <div v-for="h in highlights" :key="h.label" 
        :class="h.featured ? 'border-2 border-[#0052FF]' : 'border border-slate-100'"
        class="m-card group">
        <div class="flex flex-col h-full justify-between">
          <div class="flex justify-between items-start mb-8">
            <div :class="h.featured ? 'bg-gradient-to-br from-[#0052FF] to-[#4D7CFF]' : 'bg-slate-100'"
              class="h-14 w-14 rounded-2xl flex items-center justify-center transition-transform group-hover:rotate-12 duration-500">
              <Icon :name="h.icon" size="24px" :class="h.featured ? 'text-white' : 'text-[#0052FF]'" />
            </div>
            <span :class="h.featured ? 'text-[#0052FF]' : 'text-emerald-500'" class="text-[10px] font-black uppercase tracking-widest">{{ h.trend }}</span>
          </div>
          <div>
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">{{ h.label }}</p>
            <p class="text-4xl font-display text-slate-900 leading-none">{{ h.value }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-16">
      <!-- Activity Pipeline -->
      <div class="col-span-2">
        <div class="flex justify-between items-end mb-10">
          <h3 class="text-3xl font-display text-slate-900">Deployment <span class="text-gradient">Pipeline</span></h3>
          <button class="text-[#0052FF] text-xs font-black uppercase tracking-widest border-b-2 border-blue-100 pb-1 hover:border-[#0052FF] transition-all">View All Activity</button>
        </div>
        
        <div class="space-y-6">
          <div v-for="act in recentActivities" :key="act.id" 
            class="m-card !p-6 flex items-center justify-between border-l-8"
            :class="act.status === 'COMPLETE' ? 'border-l-emerald-500' : act.status === 'FAILED' ? 'border-l-rose-500' : 'border-l-[#0052FF]'">
            <div class="flex items-center gap-6">
              <div class="font-mono text-xs font-black text-slate-300">{{ act.id }}</div>
              <div>
                <p class="text-lg font-bold text-slate-900">{{ act.service }}</p>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">{{ act.type }} Deployment</p>
              </div>
            </div>
            <div class="flex items-center gap-10">
              <div class="text-right">
                <p class="text-xs font-bold text-slate-600">{{ act.status }}</p>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-tighter">{{ act.time }}</p>
              </div>
              <button class="h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 hover:text-[#0052FF] transition-all">
                <Icon name="chevron-right" size="18px" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Analysis -->
      <div class="space-y-10">
        <h3 class="text-3xl font-display text-slate-900">Security <span class="text-gradient">Pulse</span></h3>
        <div class="m-card bg-[#0F172A] border-none !p-10 relative overflow-hidden group">
          <!-- Background Decoration -->
          <div class="absolute -right-10 -bottom-10 w-40 h-40 bg-[#0052FF]/10 rounded-full blur-3xl group-hover:bg-[#0052FF]/20 transition-all duration-700"></div>
          
          <div class="relative z-10">
            <div class="flex items-center gap-3 mb-10">
              <div class="pulse-dot"></div>
              <span class="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Guardian Engine</span>
            </div>
            
            <p class="text-3xl font-display text-white mb-6 leading-tight">All systems are <span class="text-[#0052FF]">hardened</span> and secure.</p>
            <p class="text-sm text-slate-400 leading-relaxed mb-10">
              L4-L7 Deep Packet Inspection is currently scanning 42.8 GB/s of ingress traffic. No anomalies detected.
            </p>
            
            <button class="btn-accent w-full flex items-center justify-center gap-3">
              <Icon name="shield-check" size="18px" />
              <span>Full Audit Run</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Final CTA Area - Featured Style -->
    <div class="m-card !bg-gradient-to-br from-[#0F172A] to-[#1E293B] border-none !p-20 text-center relative overflow-hidden">
       <div class="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full bg-gradient-to-b from-blue-500/20 to-transparent"></div>
       <h2 class="text-5xl font-display text-white relative z-10 mb-8">Ready to <span class="text-gradient">scale</span> your core?</h2>
       <p class="text-slate-400 text-lg mb-12 relative z-10 max-w-2xl mx-auto leading-relaxed">
         The Aether architecture is built for infinite growth. Add more nodes to your cluster with zero downtime deployment strategies.
       </p>
       <div class="flex justify-center gap-6 relative z-10">
         <button class="btn-accent">Provision New Instance</button>
         <button class="px-8 py-4 text-white font-bold border-2 border-white/10 rounded-xl hover:bg-white/5 transition-all">Documentation</button>
       </div>
    </div>
  </div>
</template>
