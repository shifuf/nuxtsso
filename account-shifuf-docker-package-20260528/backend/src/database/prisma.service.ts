import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

class StablePrismaBetterSqlite3 extends PrismaBetterSqlite3 {
  async connect() {
    const adapter = await super.connect();
    (adapter as unknown as { client: { pragma(sql: string): void } }).client.pragma(
      'journal_mode = MEMORY',
    );
    return adapter;
  }

  async connectToShadowDb() {
    const adapter = await super.connectToShadowDb();
    (adapter as unknown as { client: { pragma(sql: string): void } }).client.pragma(
      'journal_mode = MEMORY',
    );
    return adapter;
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new StablePrismaBetterSqlite3({
        url: process.env.DATABASE_URL ?? 'file:./prisma/backend.db',
        timeout: 5000,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
