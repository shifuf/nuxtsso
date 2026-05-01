<script setup lang="ts">
import { reactive } from 'vue'
const config = reactive({
  clusterName: 'Lattice_Ops_Core_01',
  retentionPeriod: 30,
  debugMode: false,
  apiEndpoint: 'https://api.lattice.internal'
})
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="l-box">
      <div class="l-box-header">
        <span class="l-box-title">System Configuration Environment</span>
      </div>
      <div class="p-8">
        <div class="grid grid-cols-3 gap-12">
          <div class="col-span-1">
            <h4 class="text-xs font-black text-slate-800 uppercase tracking-widest mb-2">Global Metadata</h4>
            <p class="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">Core parameters for identity orchestration and cluster identification.</p>
          </div>
          <div class="col-span-2 space-y-6">
            <div>
              <label class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Cluster Primary Name</label>
              <t-input v-model="config.clusterName" />
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Audit Log Retention (Days)</label>
              <t-input-number v-model="config.retentionPeriod" class="!w-full" />
            </div>
          </div>
        </div>

        <div class="h-px bg-slate-100 my-10"></div>

        <div class="grid grid-cols-3 gap-12">
          <div class="col-span-1">
            <h4 class="text-xs font-black text-slate-800 uppercase tracking-widest mb-2">Network Layer</h4>
            <p class="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">Internal API routing and diagnostic telemetry configuration.</p>
          </div>
          <div class="col-span-2 space-y-6">
            <div>
              <label class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Internal API Endpoint</label>
              <t-input v-model="config.apiEndpoint" />
            </div>
            <div class="flex items-center justify-between p-4 border border-slate-100 bg-slate-50/50">
              <div>
                <p class="text-xs font-bold text-slate-700 uppercase tracking-tight">Enable Debug Telemetry</p>
                <p class="text-[9px] text-slate-400 font-bold uppercase">Verbose logging for diagnostic procedures</p>
              </div>
              <t-switch v-model="config.debugMode" />
            </div>
          </div>
        </div>

        <div class="mt-12 pt-8 border-t border-slate-100 flex justify-end gap-3">
          <t-button variant="outline">Reset to Defaults</t-button>
          <t-button theme="primary">Commit Changes</t-button>
        </div>
      </div>
    </div>
    
    <div class="p-6 border border-rose-100 bg-rose-50/30">
      <div class="flex items-center gap-4">
        <div class="h-10 w-10 rounded-none bg-rose-100 flex items-center justify-center text-rose-600 border border-rose-200">
          <t-icon name="error-circle-filled" size="20px" />
        </div>
        <div class="flex-1">
          <h5 class="text-xs font-black text-rose-800 uppercase tracking-widest">Advanced Zone: Destructive Actions</h5>
          <p class="text-[10px] text-rose-600 font-bold uppercase mt-1">Purging the cluster registry will result in immediate termination of all active sessions.</p>
        </div>
        <t-button theme="danger" variant="outline">Factory Purge</t-button>
      </div>
    </div>
  </div>
</template>
