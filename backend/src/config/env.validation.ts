import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('file:./prisma/backend.db'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default(''),
  OIDC_ISSUER: z.string().default('http://localhost:3000'),
  OAUTH_CALLBACK_BASE_URL: z.string().optional(),
  FRONTEND_DIST_DIR: z.string().optional(),
  WECHAT_MINI_PROGRAM_APP_ID: z.string().default(''),
  WECHAT_MINI_PROGRAM_APP_SECRET: z.string().default(''),
  WECHAT_MINI_PROGRAM_LOGIN_PAGE: z.string().default('pages/wechat-scan-login/wechat-scan-login'),
  WECHAT_MINI_PROGRAM_QR_IMAGE_URL: z.string().default(''),
  WECHAT_MINI_PROGRAM_SCAN_URL_TEMPLATE: z.string().default(''),
  WECHAT_MINI_PROGRAM_ENV_VERSION: z
    .enum(['release', 'trial', 'develop'])
    .default('release'),
  WECHAT_MINI_PROGRAM_ALLOW_INSECURE_IDENTITY: z
    .string()
    .transform((value) => value === 'true')
    .default(false),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.coerce.number().default(3600),
  JWT_REFRESH_TOKEN_EXPIRES_IN: z.coerce.number().default(604800),
  JWT_KEY_ID: z.string().default('sso-dev-key'),
  OIDC_PRIVATE_KEY: z.string().optional(),
  OIDC_PUBLIC_KEY: z.string().optional(),
  SECRET_ENCRYPTION_KEY: z.string().optional(),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
  SESSION_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  SESSION_COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === undefined ? undefined : value === 'true'),
  BACKUP_DIR: z.string().default('backups'),
  AUTO_BACKUP_ENABLED: z
    .string()
    .transform((value) => value === 'true')
    .default(false),
  AUTO_BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  AUTO_BACKUP_RETENTION_COUNT: z.coerce.number().int().min(1).max(365).default(7),
  AUTO_BACKUP_COMPRESS: z
    .string()
    .transform((value) => value === 'true')
    .default(true),
  ADMIN_EMAIL: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  DEMO_CLIENT_ID: z.string().default(''),
  DEMO_CLIENT_SECRET: z.string().default(''),
  ENABLE_DEBUG_EMAIL_CODE: z
    .string()
    .transform((value) => value === 'true')
    .default(false),
}).superRefine((value, ctx) => {
  const hasPrivateKey = Boolean(value.OIDC_PRIVATE_KEY?.trim());
  const hasPublicKey = Boolean(value.OIDC_PUBLIC_KEY?.trim());

  if (hasPrivateKey !== hasPublicKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OIDC_PRIVATE_KEY'],
      message: 'OIDC_PRIVATE_KEY 和 OIDC_PUBLIC_KEY 必须同时配置',
    });
  }

  if (value.NODE_ENV === 'production') {
    if (!hasPrivateKey || !hasPublicKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OIDC_PRIVATE_KEY'],
        message: '生产环境必须配置持久化 OIDC_PRIVATE_KEY/OIDC_PUBLIC_KEY',
      });
    }

    const secret = value.SECRET_ENCRYPTION_KEY?.trim();
    if (
      !secret ||
      secret.length < 32 ||
      /change-me|replace-with|default|random-32-byte/i.test(secret)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SECRET_ENCRYPTION_KEY'],
        message: '生产环境必须配置真实且不少于 32 字符的 SECRET_ENCRYPTION_KEY',
      });
    }
  }
});

export function validateEnv(config: Record<string, unknown>) {
  return envSchema.parse(config);
}
