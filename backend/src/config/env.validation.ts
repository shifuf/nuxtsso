import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('file:./prisma/backend.db'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  OIDC_ISSUER: z.string().default('http://localhost:3000'),
  OAUTH_CALLBACK_BASE_URL: z.string().optional(),
  FRONTEND_DIST_DIR: z.string().optional(),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.coerce.number().default(3600),
  JWT_REFRESH_TOKEN_EXPIRES_IN: z.coerce.number().default(604800),
  JWT_KEY_ID: z.string().default('sso-dev-key'),
  OIDC_PRIVATE_KEY: z.string().optional(),
  OIDC_PUBLIC_KEY: z.string().optional(),
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
    .default(true),
});

export function validateEnv(config: Record<string, unknown>) {
  return envSchema.parse(config);
}
