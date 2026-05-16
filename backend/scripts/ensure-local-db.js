require('dotenv/config');

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

const REQUIRED_TABLES = ['User', 'Application', 'SocialProvider'];
const CREATE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "passwordHash" TEXT,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "role" TEXT NOT NULL DEFAULT 'USER',
  "avatar" TEXT,
  "registrationSource" TEXT,
  "registerClientId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User"("phone");

CREATE TABLE IF NOT EXISTS "Application" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "clientId" TEXT NOT NULL,
  "clientSecretHash" TEXT NOT NULL,
  "encryptedClientSecret" TEXT,
  "redirectUris" TEXT NOT NULL,
  "scopes" TEXT NOT NULL,
  "allowRegistration" INTEGER NOT NULL DEFAULT 1,
  "enabledSocialProviders" TEXT,
  "ownerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Application_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Application_clientId_key" ON "Application"("clientId");
CREATE INDEX IF NOT EXISTS "Application_ownerId_idx" ON "Application"("ownerId");

CREATE TABLE IF NOT EXISTS "SocialAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "profile" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_provider_providerUserId_key"
  ON "SocialAccount"("provider", "providerUserId");

CREATE TABLE IF NOT EXISTS "VerificationCode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "context" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "VerificationCode_email_type_idx"
  ON "VerificationCode"("email", "type");

CREATE TABLE IF NOT EXISTS "OauthAuthorizationCode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "scopes" TEXT NOT NULL,
  "state" TEXT,
  "nonce" TEXT,
  "codeChallenge" TEXT,
  "codeChallengeMethod" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OauthAuthorizationCode_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Application" ("clientId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OauthAuthorizationCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OauthAuthorizationCode_code_key"
  ON "OauthAuthorizationCode"("code");
CREATE INDEX IF NOT EXISTS "OauthAuthorizationCode_clientId_userId_idx"
  ON "OauthAuthorizationCode"("clientId", "userId");

CREATE TABLE IF NOT EXISTS "OauthToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "clientId" TEXT,
  "userId" TEXT NOT NULL,
  "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
  "scopes" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "refreshExpiresAt" DATETIME,
  "revoked" INTEGER NOT NULL DEFAULT 0,
  "userAgent" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OauthToken_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Application" ("clientId")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "OauthToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OauthToken_accessToken_key"
  ON "OauthToken"("accessToken");
CREATE UNIQUE INDEX IF NOT EXISTS "OauthToken_refreshToken_key"
  ON "OauthToken"("refreshToken");
CREATE INDEX IF NOT EXISTS "OauthToken_userId_idx" ON "OauthToken"("userId");

CREATE TABLE IF NOT EXISTS "SocialProvider" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'oauth',
  "enabled" INTEGER NOT NULL DEFAULT 0,
  "clientId" TEXT NOT NULL DEFAULT '',
  "clientSecret" TEXT NOT NULL DEFAULT '',
  "apiUrl" TEXT DEFAULT '',
  "redirectUri" TEXT,
  "scopes" TEXT,
  "authUrl" TEXT,
  "tokenUrl" TEXT,
  "userInfoUrl" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialProvider_name_key"
  ON "SocialProvider"("name");

CREATE TABLE IF NOT EXISTS "SystemSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SystemSetting_key_key"
  ON "SystemSetting"("key");

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "targetId" TEXT,
  "applicationId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "metadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx"
  ON "AuditLog"("action", "createdAt");
`;

function resolveDatabaseUrl() {
  return process.env.DATABASE_URL || 'file:./prisma/backend.db';
}

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl.startsWith('file:')) {
    return null;
  }

  const relativePath = databaseUrl.slice('file:'.length);
  return path.resolve(process.cwd(), relativePath);
}

function hasRequiredTables(databaseFile) {
  if (!fs.existsSync(databaseFile) || fs.statSync(databaseFile).size === 0) {
    return false;
  }

  try {
    const db = new Database(databaseFile, { readonly: true });
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    const tableNames = new Set(rows.map((row) => row.name));
    db.close();
    return REQUIRED_TABLES.every((table) => tableNames.has(table));
  } catch (error) {
    console.warn(
      `[db:ensure] Existing SQLite file is not readable (${error.code || error.message}). It will be recreated.`,
    );
    return false;
  }
}

function createSchema(databaseFile) {
  const db = new Database(databaseFile);

  try {
    db.pragma('journal_mode = MEMORY');
    db.exec(CREATE_SCHEMA_SQL);
  } finally {
    db.close();
  }
}

function runSeed() {
  execFileSync(process.execPath, [path.resolve(__dirname, '../prisma/seed.js')], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
}

function backupFileIfExists(filePath, suffix) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.renameSync(filePath, `${filePath}.${suffix}.bak`);
}

function recreateDatabaseFiles(databaseFile) {
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  backupFileIfExists(databaseFile, suffix);
  backupFileIfExists(`${databaseFile}-journal`, suffix);
  backupFileIfExists(`${databaseFile}-wal`, suffix);
  backupFileIfExists(`${databaseFile}-shm`, suffix);
}

function ensureDatabaseDirectory(databaseFile) {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
}

function main() {
  const databaseUrl = resolveDatabaseUrl();
  const databaseFile = resolveSqlitePath(databaseUrl);

  if (!databaseFile) {
    console.log(
      '[db:ensure] Skipped automatic setup because DATABASE_URL is not a local SQLite file.',
    );
    return;
  }

  ensureDatabaseDirectory(databaseFile);

  if (hasRequiredTables(databaseFile)) {
    console.log(`[db:ensure] Database is ready: ${databaseFile}`);
    return;
  }

  if (fs.existsSync(databaseFile) && fs.statSync(databaseFile).size > 0) {
    recreateDatabaseFiles(databaseFile);
  }

  console.log(`[db:ensure] Initializing SQLite database: ${databaseFile}`);
  createSchema(databaseFile);
  runSeed();
}

main();
