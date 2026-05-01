<script setup lang="ts">
const resourceGroups = [
  { id: 'RG-402', name: 'Global_Auth_Tier_1', instances: 12, region: 'us-east', owner: 'ops_root', created: '2026-01-12' },
  { id: 'RG-881', name: 'Identity_Validation_Service', instances: 8, region: 'eu-west', owner: 'ops_root', created: '2026-02-05' },
  { id: 'RG-922', name: 'Legacy_API_Gateway', instances: 4, region: 'ap-south', owner: 'admin_02', created: '2026-03-20' },
  { id: 'RG-105', name: 'Compliance_Audit_Node', instances: 2, region: 'us-west', owner: 'sec_ops', created: '2026-04-15' },
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex justify-between items-end">
      <div>
        <h2 class="text-xl font-black text-slate-800 uppercase tracking-tight">Resource Management</h2>
        <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Total active resource groups: 04</p>
      </div>
      <div class="flex gap-2">
        <t-input placeholder="Filter by Group ID or Name..." class="!w-64" size="small" />
        <t-button theme="primary">Provision New Group</t-button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4">
      <div v-for="rg in resourceGroups" :key="rg.id" class="l-box flex items-center p-4 hover:border-slate-300 transition-all cursor-pointer">
        <div class="h-10 w-10 bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 mr-6">
          <t-icon name="server" size="20px" />
        </div>
        
        <div class="flex-1 grid grid-cols-5 gap-8">
          <div>
            <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Group Identifier</p>
            <p class="text-xs font-mono font-bold text-slate-700 uppercase">{{ rg.id }}</p>
          </div>
          <div>
            <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Display Name</p>
            <p class="text-xs font-bold text-slate-700 tracking-tight">{{ rg.name }}</p>
          </div>
          <div>
            <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Instance Count</p>
            <p class="text-xs font-bold text-slate-700">{{ rg.instances }} Nodes</p>
          </div>
          <div>
            <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Zone/Region</p>
            <p class="text-xs font-bold text-slate-700 uppercase tracking-tighter">{{ rg.region }}</p>
          </div>
          <div>
            <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Administrative Owner</p>
            <p class="text-xs font-bold text-slate-700">{{ rg.owner }}</p>
          </div>
        </div>

        <div class="flex gap-2 ml-8">
          <t-button variant="outline" shape="square" size="small"><t-icon name="edit" /></t-button>
          <t-button variant="outline" shape="square" size="small"><t-icon name="more" /></t-button>
        </div>
      </div>
    </div>

    <!-- Featured Config Section -->
    <div class="grid grid-cols-2 gap-6">
      <div class="l-box border-t-4 border-t-blue-600">
        <div class="l-box-header">
          <span class="l-box-title">Featured Infrastructure Group</span>
          <span class="l-tag l-tag-ok">Optimized</span>
        </div>
        <div class="p-6">
          <div class="flex justify-between items-center mb-6">
            <h4 class="text-sm font-black text-slate-800 uppercase tracking-wider">Cluster: OIDC_GLOBAL_CORE</h4>
            <span class="text-xs font-mono font-bold text-blue-600">CIDR: 10.0.0.0/16</span>
          </div>
          <div class="space-y-4">
            <div class="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
              <span>Traffic Load Distribution</span>
              <span>88.4% Efficiency</span>
            </div>
            <div class="h-2 bg-slate-100 overflow-hidden">
              <div class="h-full bg-blue-600" style="width: 88.4%"></div>
            </div>
          </div>
          <div class="mt-8 grid grid-cols-3 gap-4">
            <div v-for="i in 3" :key="i" class="text-center p-3 border border-slate-100 bg-slate-50/50">
              <p class="text-[8px] font-black text-slate-400 uppercase mb-1">Metric 0{{ i }}</p>
              <p class="text-sm font-black text-slate-800">4.{{ i }}ms</p>
            </div>
          </div>
        </div>
      </div>

      <div class="l-box border-t-4 border-t-emerald-600">
        <div class="l-box-header">
          <span class="l-box-title">Auto-Scaling Events</span>
          <span class="l-tag l-tag-ok">Stable</span>
        </div>
        <div class="p-0">
          <div v-for="j in 4" :key="j" class="p-4 border-b border-slate-50 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
            <div class="flex items-center gap-3">
              <div class="h-1.5 w-1.5 rounded-full bg-slate-300"></div>
              <span class="text-[11px] font-bold text-slate-600 uppercase tracking-tight">Node_Scale_{{ j }}01_Event</span>
            </div>
            <span class="data-mono text-slate-400 text-[10px] uppercase">Complete: 14:{{ j }}2:05</span>
          </div>
          <div class="p-4 flex justify-center">
            <t-button variant="text" size="small" class="!text-[10px] !font-black !text-slate-400 uppercase tracking-[0.1em]">View historical scale events</t-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
