require('dotenv/config');

const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient, UserRole, UserStatus, ApplicationStatus } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || 'file:./prisma/dev.db',
  }),
});

function randomToken(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function resolveDemoRedirectUris() {
  if (process.env.DEMO_CLIENT_REDIRECT_URIS) {
    return Array.from(
      new Set(
        process.env.DEMO_CLIENT_REDIRECT_URIS
          .split(/[,\r\n]/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  return [
    'http://localhost:5173/oauth/callback',
    'http://localhost:5173/test',
    'http://localhost:5601/',
    'http://localhost:5602/',
    'http://localhost:5603/',
  ];
}

async function main() {
  const adminPassword = process.env.ADMIN_PASSWORD || '123456';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@sso.local';
  const demoRedirectUris = resolveDemoRedirectUris();
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      username: 'admin',
      registrationSource: 'setup',
    },
    create: {
      email: adminEmail,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      username: 'admin',
      registrationSource: 'setup',
    },
  });

  const clientSecret = process.env.DEMO_CLIENT_SECRET || 'demo-secret-123456';
  const clientSecretHash = await bcrypt.hash(clientSecret, 10);
  const clientId = process.env.DEMO_CLIENT_ID || 'demo-web-client';

  await prisma.application.upsert({
    where: { clientId },
    update: {
      name: '演示接入应用',
      description: '用于联调授权码流程的默认应用',
      clientSecretHash,
      redirectUris: JSON.stringify(demoRedirectUris),
      scopes: JSON.stringify(['openid', 'profile', 'email']),
      allowRegistration: true,
      status: ApplicationStatus.ACTIVE,
    },
    create: {
      name: '演示接入应用',
      description: '用于联调授权码流程的默认应用',
      clientId,
      clientSecretHash,
      redirectUris: JSON.stringify(demoRedirectUris),
      scopes: JSON.stringify(['openid', 'profile', 'email']),
      allowRegistration: true,
      status: ApplicationStatus.ACTIVE,
    },
  });

  console.log('Seed completed');
  console.log(`Admin: admin / ${adminPassword} (email: ${admin.email})`);
  console.log(`Demo client: ${clientId} / ${clientSecret}`);
  console.log(`Demo redirects: ${demoRedirectUris.join(', ')}`);
  console.log(`Admin user id: ${admin.id}`);
  console.log(`Trace token: ${randomToken('seed')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
