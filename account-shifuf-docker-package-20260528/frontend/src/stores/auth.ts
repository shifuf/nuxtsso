import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AuthResponse, UserProfile } from '../types/api';
import { authApi } from '../api/auth';

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
  user: UserProfile | null;
}

const STORAGE_KEY = 'sso-auth-session';

function loadSession(): AuthSession {
  const fallback: AuthSession = {
    accessToken: '',
    refreshToken: '',
    tokenType: 'Bearer',
    expiresIn: 0,
    scope: '',
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

  const isAuthenticated = computed(() => Boolean(session.value.accessToken));
  const user = computed(() => session.value.user);

  function persist() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session.value));
  }

  function applySession(payload: AuthResponse) {
    session.value = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type,
      expiresIn: payload.expires_in,
      scope: payload.scope,
      user: payload.user,
    };
    persist();
  }

  function clearSession() {
    session.value = {
      accessToken: '',
      refreshToken: '',
      tokenType: 'Bearer',
      expiresIn: 0,
      scope: '',
      user: null,
    };
    window.localStorage.removeItem(STORAGE_KEY);
  }

  async function refreshSession() {
    if (!session.value.accessToken) {
      return null;
    }

    try {
      const profile = await authApi.getSession();
      session.value.user = profile;
      persist();
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
    clearSession,
    refreshSession,
  };
});
