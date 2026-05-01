import { createApp } from 'vue';
import { createPinia } from 'pinia';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import App from './App.vue';
import router from './router';
import './styles/main.scss';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(TDesign);

// Check setup status and redirect to /setup if not initialized
router.isReady().then(async () => {
  try {
    const resp = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/setup/status`);
    if (resp.ok) {
      const status = await resp.json();
      if (!status.initialized && router.currentRoute.value.path !== '/setup') {
        router.replace('/setup');
      }
    }
  } catch {
    // Backend not available, let normal flow handle it
  }

  app.mount('#app');
});
