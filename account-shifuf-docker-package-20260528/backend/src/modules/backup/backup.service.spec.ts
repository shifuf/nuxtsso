import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { BackupService } from './backup.service';

describe('BackupService', () => {
  const tempRoot = resolve(process.cwd(), 'test', '.backup-unit');
  const databasePath = resolve(tempRoot, 'db.sqlite');
  const backupDir = resolve(tempRoot, 'backups');
  const readSetting = (settings: Map<string, string>, key: string) =>
    settings.has(key) ? { key, value: settings.get(key)! } : null;

  let settings: Map<string, string>;
  let service: BackupService;

  beforeEach(async () => {
    rmSync(tempRoot, { recursive: true, force: true });
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(databasePath, 'seed-backup-data');
    settings = new Map<string, string>();

    const configService = new ConfigService({
      DATABASE_URL: 'file:./test/.backup-unit/db.sqlite',
      BACKUP_DIR: './test/.backup-unit/backups',
      AUTO_BACKUP_ENABLED: false,
      AUTO_BACKUP_INTERVAL_HOURS: 24,
      AUTO_BACKUP_RETENTION_COUNT: 7,
      AUTO_BACKUP_COMPRESS: true,
    });

    const prismaService = {
      systemSetting: {
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
          readSetting(settings, where.key),
        ),
        upsert: jest.fn(
          async ({
            where,
            update,
            create,
          }: {
            where: { key: string };
            update: { value: string };
            create: { key: string; value: string };
          }) => {
            const value = settings.has(where.key) ? update.value : create.value;
            settings.set(where.key, value);
            return { key: where.key, value };
          },
        ),
      },
    };

    service = new BackupService(
      configService,
      prismaService as never,
    );
    await service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates a compressed backup and restores it', async () => {
    const backup = await service.createBackup({
      trigger: 'manual',
      compress: true,
    });

    expect(backup.trigger).toBe('manual');
    expect(backup.compressed).toBe(true);
    expect(existsSync(resolve(backupDir, backup.filename))).toBe(true);

    writeFileSync(databasePath, 'mutated-data');
    await service.restoreBackup({ filename: backup.filename });

    expect(readFileSync(databasePath, 'utf8')).toBe('seed-backup-data');
  });

  it('stores automation config and prunes older scheduled backups', async () => {
    const config = await service.updateConfig({
      enabled: true,
      intervalHours: 2,
      retentionCount: 1,
      compress: false,
    });

    expect(config.enabled).toBe(true);
    expect(config.nextRunAt).not.toBeNull();

    const first = await service.createBackup({
      trigger: 'scheduled',
      compress: false,
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    writeFileSync(databasePath, 'newer-data');
    const second = await service.createBackup({
      trigger: 'scheduled',
      compress: false,
    });
    const removeFileSpy = jest
      .spyOn(
        service as unknown as {
          removeFile: (filePath: string) => void;
        },
        'removeFile',
      )
      .mockImplementation(() => undefined);

    await (
      service as unknown as {
        pruneScheduledBackups: (retentionCount: number) => Promise<void>;
      }
    ).pruneScheduledBackups(1);

    expect(removeFileSpy).toHaveBeenCalledWith(resolve(backupDir, first.filename));
    expect(removeFileSpy).not.toHaveBeenCalledWith(resolve(backupDir, second.filename));
  });
});
