import { createApp } from 'vue';
import { createPinia } from 'pinia';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import App from './App.vue';
import router from './router';
import './styles/main.scss';

const THEME_STORAGE_KEY = 'nexus-sso-theme-mode';
const applyInitialTheme = () => {
  const root = document.documentElement;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  const next = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;

  root.removeAttribute('theme-mode');
  root.setAttribute('data-app-theme', next);
};

applyInitialTheme();

// Patch: make scroll-blocking events passive to avoid Chrome Violation warnings
const PASSIVE_EVENTS = new Set(['touchstart', 'touchmove', 'wheel', 'mousewheel']);
const origAddEventListener = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function (type: string, listener: any, options?: any) {
  if (PASSIVE_EVENTS.has(type) && (typeof options === 'boolean' || !options?.passive)) {
    options = typeof options === 'object' ? { ...options, passive: true } : { passive: true };
  }
  return origAddEventListener.call(this, type, listener, options);
};

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
