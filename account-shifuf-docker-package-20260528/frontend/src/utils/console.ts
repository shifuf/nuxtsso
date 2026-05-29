import type { AuditCategory } from '../types/api';

export interface ConsoleNavItem {
  key: 'account' | 'overview' | 'users' | 'applications' | 'docs' | 'audit' | 'system';
  label: string;
  description: string;
  icon: string;
  to: string;
  adminOnly?: boolean;
}

export const consoleNavItems: ConsoleNavItem[] = [
  {
    key: 'overview',
    label: '运营概览',
    description: '查看认证中心的运行态势与接入健康度。',
    icon: 'dashboard',
    to: '/user/overview',
    adminOnly: true,
  },
  {
    key: 'users',
    label: '用户管理',
    description: '增删改查用户账号、角色与验证状态。',
    icon: 'usergroup',
    to: '/user/users',
    adminOnly: true,
  },
  {
    key: 'applications',
    label: '应用接入',
    description: '配置回调地址、范围与客户端密钥。',
    icon: 'component-breadcrumb',
    to: '/user/applications',
    adminOnly: true,
  },
  {
    key: 'docs',
    label: '对接文档',
    description: '查看 OAuth2 / OIDC 对接流程与参数说明。',
    icon: 'file-paste',
    to: '/user/docs',
  },
  {
    key: 'audit',
    label: '审计日志',
    description: '追踪登录、授权与管理员操作流水。',
    icon: 'order-adjustment-column',
    to: '/user/audit',
    adminOnly: true,
  },
  {
    key: 'system',
    label: '系统设置',
    description: '检查健康状态、端点暴露与上线准备度。',
    icon: 'setting',
    to: '/user/system',
    adminOnly: true,
  },
  {
    key: 'account',
    label: '我的账号',
    description: '管理个人资料、手机号与第三方绑定。',
    icon: 'user',
    to: '/user/account',
  },
];

export const auditActionLabels: Record<string, string> = {
  'auth.email_code.login': '发送登录验证码',
  'auth.email_code.register': '发送注册验证码',
  'auth.email_code.reset-password': '发送重置密码验证码',
  'auth.login.password': '账号密码登录',
  'auth.login.email_code': '邮箱验证码登录',
  'auth.register': '注册新账号',
  'auth.reset_password': '重置密码',
  'auth.session.revoked': '注销登录会话',
  'auth.sessions.revoked_others': '清理其他登录会话',
  'auth.profile.updated': '更新个人资料',
  'auth.phone.bound': '绑定手机号',
  'auth.phone.unbound': '解绑手机号',
  'oauth2.authorize': '批准应用授权',
  'admin.user.created': '新建用户',
  'admin.user.password_reset': '重置用户密码',
  'admin.user.updated': '更新用户信息',
  'admin.user.status.updated': '更新用户状态',
  'admin.user.deleted': '删除用户',
  'admin.application.created': '新建应用',
  'admin.application.updated': '更新应用配置',
  'admin.application.status.updated': '更新应用状态',
  'admin.application.deleted': '删除应用',
  'admin.application.secret_reset': '重置应用密钥',
  'admin.social_provider.updated': '更新第三方登录配置',
  'admin.social_provider.deleted': '删除第三方登录',
  'admin.email_config.updated': '更新邮件配置',
  'admin.site_config.updated': '更新站点信息',
  'admin.backup.config_updated': '更新自动备份配置',
  'admin.backup.created': '创建备份',
  'admin.backup.restored': '恢复备份',
  'admin.backup.deleted': '删除备份',
};

export const auditCategoryLabels: Record<AuditCategory, string> = {
  auth: '认证',
  oauth2: '授权',
  admin: '后台',
  system: '系统',
};

export function formatAuditAction(action: string) {
  return action.replaceAll('.', ' / ');
}

export function parseBrowser(ua?: string | null): string {
  if (!ua) return '未知浏览器'
  if (ua.includes('Edg/')) return 'Edge'
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera'
  if (ua.includes('Chrome') && !ua.includes('Chromium')) return 'Chrome'
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari'
  if (ua.includes('Chromium')) return 'Chromium'
  return '未知浏览器'
}

export function formatAuditCategory(category: AuditCategory) {
  return auditCategoryLabels[category] ?? auditCategoryLabels.system;
}

export interface ActionTag {
  label: string;
  cls: string;
}

const ACTION_TAGS: Record<string, ActionTag> = {
  created:     { label: '新建', cls: 'tag--green' },
  register:    { label: '注册', cls: 'tag--green' },
  deleted:     { label: '删除', cls: 'tag--red' },
  updated:     { label: '更新', cls: 'tag--blue' },
  status_updated: { label: '更新', cls: 'tag--blue' },
  reset:       { label: '重置', cls: 'tag--amber' },
  reset_password: { label: '重置', cls: 'tag--amber' },
  password_reset: { label: '重置', cls: 'tag--amber' },
  revoked:     { label: '注销', cls: 'tag--red' },
  authorize:   { label: '授权', cls: 'tag--amber' },
  login:       { label: '登录', cls: 'tag--blue' },
  restored:    { label: '恢复', cls: 'tag--amber' },
  secret_reset: { label: '重置', cls: 'tag--amber' },
};

export function getActionTag(action: string): ActionTag | null {
  const parts = action.split('.');
  const last = parts[parts.length - 1];
  return ACTION_TAGS[last] ?? null;
}

export function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatShortDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}
