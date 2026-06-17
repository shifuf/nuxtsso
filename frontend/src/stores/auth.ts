import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AuthResponse, UserProfile } from '../types/api';
import { authApi } from '../api/auth';

interface AuthSession {
  user: UserProfile | null;
}

const STORAGE_KEY = 'sso-auth-session';

function loadSession(): AuthSession {
  const fallback: AuthSession = {
    user: null,
  };

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return fallback;
  }

  try {
    return {
      ...fallback,
      ...JSON.parse(raw),
    } as AuthSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return fallback;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<AuthSession>(loadSession());

  const isAuthenticated = computed(() => Boolean(session.value.user));
  const user = computed(() => session.value.user);

  function persist() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session.value));
  }

  function applySession(payload: AuthResponse) {
    session.value = {
      user: payload.user,
    };
    persist();
  }

  function applyUser(profile: UserProfile) {
    session.value = { user: profile };
    persist();
  }

  function clearSession() {
    session.value = {
      user: null,
    };
    window.localStorage.removeItem(STORAGE_KEY);
  }

  async function refreshSession() {
    try {
      const profile = await authApi.getSession();
      applyUser(profile);
      return profile;
    } catch (error) {
      clearSession();
      throw error;
    }
  }

  return {
    session,
    user,
    isAuthenticated,
    applySession,
    applyUser,
    clearSession,
    refreshSession,
  };
});
