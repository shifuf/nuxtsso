import http from './http';
import type {
  AccountSession,
  ApplicationCreateResponse,
  ApplicationItem,
  AuthResponse,
  SetupPayload,
  SetupStatus,
  SiteConfig,
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
}

export interface AccountApplicationPayload {
  name: string;
  description?: string;
  redirectUris: string[];
  scopes: string[];
  allowRegistration: boolean;
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
  async logout() {
    const { data } = await http.post('/api/auth/logout');
    return data as { success: boolean };
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
  async uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);
    const { data } = await http.post('/api/auth/account/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data as UserProfile;
  },
  async listAccountApplications() {
    const { data } = await http.get('/api/auth/account/applications');
    return data as ApplicationItem[];
  },
  async createAccountApplication(payload: AccountApplicationPayload) {
    const { data } = await http.post('/api/auth/account/applications', payload);
    return data as ApplicationCreateResponse;
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
    return data as Array<{ name: string; type?: string; enabled: boolean }>;
  },
  async createSocialLoginQr(provider: string, clientId?: string, redirectUri?: string) {
    const { data } = await http.post(`/api/auth/social/${provider}/login-qr`, {
      clientId,
      redirectUri,
    });
    return data as { authorizeUrl: string; qrCodeUrl?: string | null; state: string };
  },
  async getSocialLoginStatus(state: string) {
    const { data } = await http.get('/api/auth/social/login-status', {
      params: { state },
    });
    return data as {
      status: 'pending' | 'scanned' | 'completed' | 'failed' | 'expired';
      provider?: string;
      ticket?: string | null;
      error?: string | null;
      completedAt?: string | null;
      scannedAt?: string | null;
    };
  },
  async redeemSocialLoginTicket(ticket: string) {
    const { data } = await http.post('/api/auth/social/redeem-ticket', { ticket });
    return data as AuthResponse;
  },
  async createWechatMiniLoginQr(clientId?: string, redirectUri?: string) {
    const { data } = await http.post('/api/auth/wechat-mini/login-qr', {
      clientId,
      redirectUri,
    });
    return data as {
      state: string;
      miniProgramPath: string;
      scene: string;
      qrCodeUrl?: string | null;
      qrMode: 'dynamic' | 'fixed' | 'fallback' | 'platform';
      qrContent: string;
      expiresIn: number;
    };
  },
  async getWechatMiniLoginStatus(state: string) {
    const { data } = await http.get('/api/auth/wechat-mini/login-status', {
      params: { state },
    });
    return data as {
      status: 'pending' | 'scanned' | 'completed' | 'failed' | 'expired';
      provider?: string;
      ticket?: string | null;
      error?: string | null;
      completedAt?: string | null;
      scannedAt?: string | null;
    };
  },
  async getPublicConfig() {
    const { data } = await http.get('/api/auth/config');
    return data as { requireEmailVerification: boolean; publicApiEnabled: boolean; site?: SiteConfig };
  },
  async getSiteConfig() {
    const { data } = await http.get('/api/auth/site-config');
    return data as SiteConfig;
  },
  async listSocialBindings() {
    const { data } = await http.get('/api/auth/social/bindings');
    return data as SocialAccountBinding[];
  },
  async createSocialBind(provider: string, returnTo?: string) {
    const { data } = await http.post(`/api/auth/social/${provider}/bind`, {
      returnTo,
    });
    return data as { authorizeUrl: string; qrCodeUrl?: string | null; state: string };
  },
  async getSocialBindStatus(state: string) {
    const { data } = await http.get('/api/auth/social/bind-status', {
      params: { state },
    });
    return data as {
      status: 'pending' | 'scanned' | 'completed' | 'failed' | 'expired';
      provider?: string;
      bindingId?: string | null;
      error?: string | null;
      completedAt?: string | null;
      scannedAt?: string | null;
    };
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
  async transferSocialBinding(username: string, password: string, provider?: string) {
    const { data } = await http.post('/api/auth/social/transfer-binding', {
      provider,
      username,
      password,
    });
    return data as AuthResponse;
  },
};
