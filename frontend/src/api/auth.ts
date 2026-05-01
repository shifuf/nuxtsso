import http from './http';
import type {
  AccountSession,
  AuthResponse,
  SetupPayload,
  SetupStatus,
  SocialAccountBinding,
  UserProfile,
} from '../types/api';

export interface SendEmailCodePayload {
  email: string;
  type: 'login' | 'register' | 'reset-password';
  clientId?: string;
  redirectUri?: string;
}

export interface LoginPayload {
  username: string;
  password: string;
  mainSite?: boolean;
}

export interface LoginEmailPayload {
  email: string;
  code: string;
  clientId?: string;
  redirectUri?: string;
}

export interface RegisterPayload {
  email?: string;
  code?: string;
  password: string;
  username?: string;
  clientId: string;
  redirectUri: string;
}

export interface ResetPasswordPayload {
  email: string;
  code: string;
  newPassword: string;
}

export interface UpdateProfilePayload {
  username?: string;
  avatar?: string | null;
}

export const authApi = {
  async getSetupStatus() {
    const { data } = await http.get('/api/setup/status');
    return data as SetupStatus;
  },
  async runSetup(payload: SetupPayload) {
    const { data } = await http.post('/api/setup', payload);
    return data as AuthResponse;
  },
  async sendEmailCode(payload: SendEmailCodePayload) {
    const { data } = await http.post('/api/auth/send-email-code', payload);
    return data as { success: boolean; expiresAt: string; debugCode?: string };
  },
  async login(payload: LoginPayload) {
    const { data } = await http.post('/api/auth/login', payload);
    return data as AuthResponse;
  },
  async loginEmail(payload: LoginEmailPayload) {
    const { data } = await http.post('/api/auth/login-email', payload);
    return data as AuthResponse;
  },
  async register(payload: RegisterPayload) {
    const { data } = await http.post('/api/auth/register', payload);
    return data as AuthResponse;
  },
  async resetPassword(payload: ResetPasswordPayload) {
    const { data } = await http.post('/api/auth/reset-password', payload);
    return data as { success: boolean };
  },
  async getSession() {
    const { data } = await http.get('/api/auth/session');
    return data as UserProfile;
  },
  async listSessions() {
    const { data } = await http.get('/api/auth/account/sessions');
    return data as AccountSession[];
  },
  async revokeSession(id: string) {
    const { data } = await http.delete(`/api/auth/account/sessions/${id}`);
    return data as { success: boolean; current: boolean };
  },
  async revokeOtherSessions() {
    const { data } = await http.delete('/api/auth/account/sessions');
    return data as { success: boolean; revokedCount: number };
  },
  async updateProfile(payload: UpdateProfilePayload) {
    const { data } = await http.put('/api/auth/account/profile', payload);
    return data as UserProfile;
  },
  async bindPhone(phone: string) {
    const { data } = await http.put('/api/auth/account/phone', { phone });
    return data as UserProfile;
  },
  async unbindPhone() {
    const { data } = await http.delete('/api/auth/account/phone');
    return data as UserProfile;
  },
  async getSocialProviders(clientId?: string) {
    const { data } = await http.get('/api/auth/social-providers', {
      params: clientId ? { clientId } : undefined,
    });
    return data as Array<{ name: string; enabled: boolean }>;
  },
  async getPublicConfig() {
    const { data } = await http.get('/api/auth/config');
    return data as { requireEmailVerification: boolean; publicApiEnabled: boolean };
  },
  async listSocialBindings() {
    const { data } = await http.get('/api/auth/social/bindings');
    return data as SocialAccountBinding[];
  },
  async createSocialBind(provider: string, returnTo?: string) {
    const { data } = await http.post(`/api/auth/social/${provider}/bind`, {
      returnTo,
    });
    return data as { authorizeUrl: string; state: string };
  },
  async unbindSocial(provider: string) {
    const { data } = await http.delete(`/api/auth/social/${provider}/bind`);
    return data as { success: boolean };
  },
  async bindExistingSocial(state: string, username: string, password: string) {
    const { data } = await http.post('/api/auth/social/bind-existing', {
      state,
      username,
      password,
    });
    return data as AuthResponse;
  },
  async setPassword(password: string) {
    const { data } = await http.put('/api/auth/account/set-password', { password });
    return data as UserProfile;
  },
  async transferSocialBinding(provider: string, username: string, password: string) {
    const { data } = await http.post('/api/auth/social/transfer-binding', {
      provider,
      username,
      password,
    });
    return data as AuthResponse;
  },
};
