export interface UserProfile {
  id: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  status: 'active' | 'disabled';
  role: 'admin' | 'user';
  avatar: string | null;
  registrationSource: string | null;
  registerClientId?: string | null;
  registerClientName?: string | null;
  hasPassword?: boolean;
  socialAccounts?: { provider: string; providerUserId: string }[];
  boundToUser?: { id: string; username: string | null; email: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

export interface AuthResponse extends TokenSet {
  user: UserProfile;
}

export interface ApplicationItem {
  id: string;
  name: string;
  description: string | null;
  clientId: string;
  redirectUris: string[];
  scopes: string[];
  allowRegistration: boolean;
  enabledSocialProviders: string[];
  ownerId: string | null;
  owner?: { id: string; username: string | null; email: string | null } | null;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationCreateResponse extends ApplicationItem {
  clientSecret: string;
}

export interface AuthorizeContext {
  clientId: string;
  clientName: string;
  description: string | null;
  redirectUri: string;
  allowRegistration: boolean;
  requestedScopes: string[];
  availableScopes: string[];
  requireEmailVerification: boolean;
}

export type AuditCategory = 'auth' | 'oauth2' | 'admin' | 'system';

export interface AuditLogItem {
  id: string;
  action: string;
  category: AuditCategory;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: UserProfile['role'] | null;
  targetId: string | null;
  applicationId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditTopAction {
  action: string;
  count: number;
  category: AuditCategory;
}

export interface AuditSummary {
  windowDays: number;
  total: number;
  last24Hours: number;
  identityEvents: number;
  adminEvents: number;
  uniqueActors: number;
  topActions: AuditTopAction[];
}

export interface ServiceRootInfo {
  name: string;
  status: string;
  issuer: string;
  docs: string[];
}

export interface SystemHealth {
  status: string;
  timestamp: string;
}

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  response_types_supported?: string[];
  scopes_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  [key: string]: unknown;
}

export interface JwksKey {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

export interface JwksDocument {
  keys: JwksKey[];
}

export interface SocialProviderConfig {
  name: string;
  type: 'oauth' | 'aggregated';
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  redirectUri: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
}

export interface SocialAccountBinding {
  id: string;
  provider: string;
  providerUserId: string;
  username: string | null;
  email: string | null;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialAccountItem {
  id: string;
  provider: string;
  providerUserId: string;
  userId: string;
  boundUsername: string | null;
  boundEmail: string | null;
  available: boolean;
}

export interface AccountSession {
  id: string;
  clientId: string | null;
  clientName: string | null;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  refreshExpiresAt: string | null;
  userAgent: string | null;
  current: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface SetupStatus {
  initialized: boolean;
  hasAdmin: boolean;
}

export interface SetupPayload {
  email: string;
  username: string;
  password: string;
  serviceName?: string;
  issuer?: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
  compressed: boolean;
  trigger: 'manual' | 'scheduled';
}

export interface BackupConfig {
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
  compress: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
}
