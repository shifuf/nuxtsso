import http from './http';
import type {
  ApplicationCreateResponse,
  ApplicationItem,
  AuditCategory,
  AuditLogItem,
  AuditSummary,
  BackupConfig,
  BackupInfo,
  EmailConfig,
  SocialAccountItem,
  SocialProviderConfig,
  UserProfile,
} from '../types/api';

export interface ApplicationPayload {
  name: string;
  description?: string;
  redirectUris: string[];
  scopes: string[];
  allowRegistration: boolean;
  enabledSocialProviders?: string[];
}

export interface CreateUserPayload {
  email: string;
  username?: string;
  password: string;
  role?: 'admin' | 'user';
}

export interface UpdateUserPayload {
  username?: string;
  avatar?: string | null;
  emailVerified?: boolean;
  role?: 'admin' | 'user';
  status?: 'active' | 'disabled';
}

export interface AuditLogQuery {
  q?: string;
  action?: string;
  category?: AuditCategory;
  limit?: number;
}

export interface SocialProviderPayload {
  type?: string;
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  apiUrl?: string;
  redirectUri?: string;
  scopes?: string[];
  authUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
}

export const adminApi = {
  // Users
  async listUsers(query?: string) {
    const { data } = await http.get('/api/admin/users', { params: query ? { q: query } : undefined });
    return data as UserProfile[];
  },
  async getUserById(id: string) {
    const { data } = await http.get(`/api/admin/users/${id}`);
    return data as UserProfile;
  },
  async createUser(payload: CreateUserPayload) {
    const { data } = await http.post('/api/admin/users', payload);
    return data as UserProfile;
  },
  async updateUser(id: string, payload: UpdateUserPayload) {
    const { data } = await http.put(`/api/admin/users/${id}`, payload);
    return data as UserProfile;
  },
  async updateUserStatus(id: string, status: 'active' | 'disabled') {
    const { data } = await http.patch(`/api/admin/users/${id}/status`, { status });
    return data as UserProfile;
  },
  async deleteUser(id: string) {
    const { data } = await http.delete(`/api/admin/users/${id}`);
    return data as { success: boolean };
  },
  async resetUserPassword(id: string, newPassword: string) {
    const { data } = await http.post(`/api/admin/users/${id}/reset-password`, { newPassword });
    return data as UserProfile;
  },

  // Applications
  async listApplications() {
    const { data } = await http.get('/api/admin/applications');
    return data as ApplicationItem[];
  },
  async getApplicationById(id: string) {
    const { data } = await http.get(`/api/admin/applications/${id}`);
    return data as ApplicationItem;
  },
  async createApplication(payload: ApplicationPayload) {
    const { data } = await http.post('/api/admin/applications', payload);
    return data as ApplicationCreateResponse;
  },
  async updateApplication(id: string, payload: Partial<ApplicationPayload>) {
    const { data } = await http.put(`/api/admin/applications/${id}`, payload);
    return data as ApplicationItem;
  },
  async updateApplicationStatus(id: string, status: 'active' | 'disabled') {
    const { data } = await http.patch(`/api/admin/applications/${id}/status`, { status });
    return data as ApplicationItem;
  },
  async deleteApplication(id: string) {
    const { data } = await http.delete(`/api/admin/applications/${id}`);
    return data as { success: boolean };
  },
  async resetSecret(id: string) {
    const { data } = await http.post(`/api/admin/applications/${id}/reset-secret`);
    return data as { clientId: string; clientSecret: string };
  },

  // Social Providers
  async listSocialProviders() {
    const { data } = await http.get('/api/admin/social-providers');
    return data as SocialProviderConfig[];
  },
  async getSocialProvider(name: string) {
    const { data } = await http.get(`/api/admin/social-providers/${name}`);
    return data as SocialProviderConfig;
  },
  async updateSocialProvider(name: string, payload: SocialProviderPayload) {
    const { data } = await http.put(`/api/admin/social-providers/${name}`, payload);
    return data as SocialProviderConfig;
  },
  async createSocialProvider(payload: { name: string; type?: string; apiUrl?: string }) {
    const { data } = await http.post('/api/admin/social-providers', payload);
    return data as SocialProviderConfig;
  },
  async initSocialProviders() {
    const { data } = await http.post('/api/admin/social-providers/init');
    return data as SocialProviderConfig[];
  },
  async deleteSocialProvider(name: string) {
    const { data } = await http.delete(`/api/admin/social-providers/${name}`);
    return data as { success: boolean };
  },

  // Social Bind Transfer (social-registered user → local account)
  async transferSocialBindings(userId: string, targetUsername: string) {
    const { data } = await http.post(`/api/admin/users/${userId}/transfer-social-to`, { targetUsername });
    return data as { success: boolean; transferred: number };
  },

  // All Social Accounts (for dropdown selection)
  async listAllSocialAccounts() {
    const { data } = await http.get('/api/admin/social-accounts');
    return data as SocialAccountItem[];
  },

  // Email Config
  async getEmailConfig() {
    const { data } = await http.get('/api/admin/email-config');
    return data as EmailConfig;
  },
  async updateEmailConfig(payload: EmailConfig) {
    const { data } = await http.put('/api/admin/email-config', payload);
    return data as EmailConfig;
  },
  async testEmailConfig(to?: string) {
    const { data } = await http.post('/api/admin/email-config/test', to ? { to } : {});
    return data as { success: boolean; message: string };
  },

  async getBackupConfig() {
    const { data } = await http.get('/api/admin/backup-config');
    return data as BackupConfig;
  },
  async updateBackupConfig(payload: Omit<BackupConfig, 'lastRunAt' | 'lastSuccessAt' | 'lastError' | 'nextRunAt'>) {
    const { data } = await http.put('/api/admin/backup-config', payload);
    return data as BackupConfig;
  },

  // Backup & Restore
  async listBackups() {
    const { data } = await http.get('/api/admin/backups');
    return data as BackupInfo[];
  },
  async createBackup() {
    const { data } = await http.post('/api/admin/backups');
    return data as BackupInfo;
  },
  async restoreBackup(filename: string) {
    const { data } = await http.post('/api/admin/backups/restore', { filename });
    return data as { success: boolean; message: string };
  },
  async deleteBackup(filename: string) {
    const { data } = await http.delete(`/api/admin/backups/${filename}`);
    return data as { success: boolean };
  },
  async downloadBackup(filename: string) {
    const response = await http.get(`/api/admin/backups/${filename}/download`, { responseType: 'blob' });
    return response.data as Blob;
  },


  // Auth Config
  async getAuthConfig() {
    const { data } = await http.get('/api/admin/auth-config');
    return data as { requireEmailVerification: boolean; publicApiEnabled: boolean };
  },
  async updateAuthConfig(payload: { requireEmailVerification: boolean; publicApiEnabled?: boolean }) {
    const { data } = await http.put('/api/admin/auth-config', payload);
    return data as { requireEmailVerification: boolean; publicApiEnabled: boolean };
  },

  // Audit
  async listAuditLogs(query?: AuditLogQuery) {
    const { data } = await http.get('/api/admin/audit-logs', { params: query });
    return data as AuditLogItem[];
  },
  async getAuditSummary(days = 7) {
    const { data } = await http.get('/api/admin/audit-logs/summary', { params: { days } });
    return data as AuditSummary;
  },

  // Social Account Binding
  async bindUserSocialAccount(userId: string, provider: string, providerUserId: string, profile?: string) {
    const { data } = await http.post(`/api/admin/users/${userId}/social-bind`, {
      provider,
      providerUserId,
      profile,
    });
    return data as { success: boolean; message?: string };
  },
  async unbindUserSocialAccount(userId: string, provider: string) {
    const { data } = await http.delete(`/api/admin/users/${userId}/social-bind/${provider}`);
    return data as { success: boolean };
  },
  async generateSocialBindUrl(userId: string, provider: string) {
    const { data } = await http.post(`/api/admin/users/${userId}/social-bind-url`, { provider });
    return data as { authorizeUrl: string; state: string };
  },
};
