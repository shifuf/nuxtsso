<script setup lang="ts">
import BrandMark from '../components/BrandMark.vue'
import ThemeSwitch from '../components/ThemeSwitch.vue'
</script>

<template>
  <div class="auth-shell">
    <div class="auth-frame">
      <div class="auth-topbar">
        <BrandMark
          title="Nexus SSO"
          subtitle="统一身份认证与授权中心"
        />
        <ThemeSwitch />
      </div>

      <router-view />
    </div>
  </div>
</template>
