import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IsBoolean,
  IsInt,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PrismaService } from '../../database/prisma.service';

const BACKUP_CONFIG_KEY = 'backup-config';

export type BackupTrigger = 'manual' | 'scheduled';

export class RestoreBackupDto {
  @IsString()
  filename!: string;
}

export class UpdateBackupConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(1)
  @Max(168)
  intervalHours!: number;

  @IsInt()
  @Min(1)
  @Max(365)
  retentionCount!: number;

  @IsBoolean()
  compress!: boolean;
}

export interface BackupMeta {
  filename: string;
  size: number;
  createdAt: string;
  compressed: boolean;
  trigger: BackupTrigger;
}

interface StoredBackupConfig {
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
  compress: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface BackupConfig extends StoredBackupConfig {
  nextRunAt: string | null;
}

interface CreateBackupOptions {
  trigger?: BackupTrigger;
  compress?: boolean;
}

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private dbPath: string | null = null;
  private backupDir!: string;
  private scheduleTimer: NodeJS.Timeout | null = null;
  private nextRunAt: Date | null = null;
  private scheduleRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  async onModuleInit() {
    this.initializePaths();
    const config = await this.getStoredConfig();
    this.scheduleNextRun(config);
  }

  onModuleDestroy() {
    this.clearSchedule();
  }

  private initializePaths() {
    const databaseUrl =
      this.configService.get<string>('DATABASE_URL') ?? 'file:./prisma/dev.db';
    const backupDir =
      this.configService.get<string>('BACKUP_DIR')?.trim() || 'backups';

    this.dbPath =
      databaseUrl.startsWith('file:') && databaseUrl !== 'file::memory:'
        ? resolve(process.cwd(), databaseUrl.replace('file:', ''))
        : null;
    this.backupDir = resolve(process.cwd(), backupDir);

    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private buildDefaultConfig(): StoredBackupConfig {
    return {
      enabled: this.configService.get<boolean>('AUTO_BACKUP_ENABLED') ?? false,
      intervalHours:
        this.configService.get<number>('AUTO_BACKUP_INTERVAL_HOURS') ?? 24,
      retentionCount:
        this.configService.get<number>('AUTO_BACKUP_RETENTION_COUNT') ?? 7,
      compress: this.configService.get<boolean>('AUTO_BACKUP_COMPRESS') ?? true,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
  }

  private normalizeConfig(
    value: Partial<StoredBackupConfig> | null | undefined,
  ): StoredBackupConfig {
    const defaults = this.buildDefaultConfig();

    return {
      enabled:
        typeof value?.enabled === 'boolean' ? value.enabled : defaults.enabled,
      intervalHours: this.normalizeIntervalHours(
        value?.intervalHours,
        defaults.intervalHours,
      ),
      retentionCount: this.normalizeRetentionCount(
        value?.retentionCount,
        defaults.retentionCount,
      ),
      compress:
        typeof value?.compress === 'boolean' ? value.compress : defaults.compress,
      lastRunAt:
        typeof value?.lastRunAt === 'string' ? value.lastRunAt : null,
      lastSuccessAt:
        typeof value?.lastSuccessAt === 'string' ? value.lastSuccessAt : null,
      lastError:
        typeof value?.lastError === 'string' && value.lastError.trim()
          ? value.lastError
          : null,
    };
  }

  private normalizeIntervalHours(value: unknown, fallback: number) {
    const parsed =
      typeof value === 'number' ? value : Number.parseInt(String(value), 10);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
      return fallback;
    }

    return parsed;
  }

  private normalizeRetentionCount(value: unknown, fallback: number) {
    const parsed =
      typeof value === 'number' ? value : Number.parseInt(String(value), 10);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      return fallback;
    }

    return parsed;
  }

  private clearSchedule() {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    this.nextRunAt = null;
  }

  private computeDelayMs(config: StoredBackupConfig) {
    const intervalMs = config.intervalHours * 60 * 60 * 1000;

    if (!config.lastSuccessAt) {
      return intervalMs;
    }

    const lastSuccessAt = new Date(config.lastSuccessAt).getTime();
    if (Number.isNaN(lastSuccessAt)) {
      return intervalMs;
    }

    return Math.max(5_000, lastSuccessAt + intervalMs - Date.now());
  }

  private scheduleNextRun(config: StoredBackupConfig) {
    this.clearSchedule();

    if (!config.enabled) {
      return;
    }

    const delayMs = this.computeDelayMs(config);
    this.nextRunAt = new Date(Date.now() + delayMs);
    this.scheduleTimer = setTimeout(() => {
      void this.runScheduledBackup();
    }, delayMs);
    this.scheduleTimer.unref?.();
  }

  private async runScheduledBackup() {
    if (this.scheduleRunning) {
      return;
    }

    this.scheduleRunning = true;
    const currentConfig = await this.getStoredConfig();

    if (!currentConfig.enabled) {
      this.scheduleRunning = false;
      this.clearSchedule();
      return;
    }

    const startedAt = new Date().toISOString();
    await this.saveConfig({
      ...currentConfig,
      lastRunAt: startedAt,
    });

    try {
      const backup = await this.createBackup({
        trigger: 'scheduled',
        compress: currentConfig.compress,
      });

      await this.pruneScheduledBackups(currentConfig.retentionCount);
      await this.saveConfig({
        ...currentConfig,
        lastRunAt: startedAt,
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
      });
      this.logger.log(`Scheduled backup created: ${backup.filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      await this.saveConfig({
        ...currentConfig,
        lastRunAt: startedAt,
        lastError: message,
      });
      this.logger.warn(`Scheduled backup failed: ${message}`);
    } finally {
      const latestConfig = await this.getStoredConfig();
      this.scheduleRunning = false;
      this.scheduleNextRun(latestConfig);
    }
  }

  private buildTimestamp() {
    const date = new Date();
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');

    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
      date.getUTCDate(),
    )}T${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(
      date.getUTCSeconds(),
    )}-${pad(date.getUTCMilliseconds(), 3)}Z`;
  }

  private buildFilename(trigger: BackupTrigger, compress: boolean) {
    return `backup-${this.buildTimestamp()}-${trigger}.db${compress ? '.gz' : ''}`;
  }

  private assertFileDatabaseAvailable() {
    if (!this.dbPath) {
      throw new BadRequestException(
        '备份功能仅支持基于文件的 SQLite 数据库',
      );
    }

    if (!existsSync(this.dbPath)) {
      throw new BadRequestException('数据库文件不存在');
    }
  }

  private getDatabasePathOrThrow() {
    this.assertFileDatabaseAvailable();
    return this.dbPath as string;
  }

  private resolveBackupPath(filename: string) {
    const safeFilename = basename(filename);

    if (safeFilename !== filename) {
      throw new BadRequestException('备份文件名无效');
    }

    return join(this.backupDir, safeFilename);
  }

  private removeFile(filePath: string) {
    rmSync(filePath, {
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }

  private toApiConfig(config: StoredBackupConfig): BackupConfig {
    return {
      ...config,
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
    };
  }

  private async saveConfig(config: StoredBackupConfig) {
    const normalized = this.normalizeConfig(config);

    await this.prismaService.systemSetting.upsert({
      where: { key: BACKUP_CONFIG_KEY },
      update: { value: JSON.stringify(normalized) },
      create: { key: BACKUP_CONFIG_KEY, value: JSON.stringify(normalized) },
    });

    return normalized;
  }

  private parseBackupFilename(filename: string): BackupMeta | null {
    const match = filename.match(
      /^backup-(.+?)-(manual|scheduled)\.db(\.gz)?$/,
    );

    if (!match) {
      return null;
    }

    const filePath = this.resolveBackupPath(filename);
    if (!existsSync(filePath)) {
      return null;
    }

    const stats = statSync(filePath);
    return {
      filename,
      size: stats.size,
      createdAt: stats.mtime.toISOString(),
      compressed: Boolean(match[3]),
      trigger: match[2] as BackupTrigger,
    };
  }

  private async pruneScheduledBackups(retentionCount: number) {
    const backups = await this.listBackups();
    const expiredBackups = backups
      .filter((backup) => backup.trigger === 'scheduled')
      .slice(retentionCount);

    for (const backup of expiredBackups) {
      const filePath = this.resolveBackupPath(backup.filename);
      if (existsSync(filePath)) {
        this.removeFile(filePath);
      }
    }
  }

  async getConfig(): Promise<BackupConfig> {
    return this.toApiConfig(await this.getStoredConfig());
  }

  async getStoredConfig(): Promise<StoredBackupConfig> {
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key: BACKUP_CONFIG_KEY },
    });

    if (!setting) {
      return this.buildDefaultConfig();
    }

    try {
      return this.normalizeConfig(
        JSON.parse(setting.value) as Partial<StoredBackupConfig>,
      );
    } catch {
      return this.buildDefaultConfig();
    }
  }

  async updateConfig(dto: UpdateBackupConfigDto): Promise<BackupConfig> {
    const currentConfig = await this.getStoredConfig();
    const nextConfig = await this.saveConfig({
      ...currentConfig,
      enabled: dto.enabled,
      intervalHours: dto.intervalHours,
      retentionCount: dto.retentionCount,
      compress: dto.compress,
    });

    if (nextConfig.enabled) {
      await this.pruneScheduledBackups(nextConfig.retentionCount);
    }

    this.scheduleNextRun(nextConfig);
    return this.toApiConfig(nextConfig);
  }

  async listBackups(): Promise<BackupMeta[]> {
    if (!existsSync(this.backupDir)) {
      return [];
    }

    return readdirSync(this.backupDir)
      .filter((filename) => filename.endsWith('.db') || filename.endsWith('.db.gz'))
      .map((filename) => this.parseBackupFilename(filename))
      .filter((backup): backup is BackupMeta => backup !== null)
      .sort((left, right) => right.filename.localeCompare(left.filename));
  }

  async createBackup(options: CreateBackupOptions = {}): Promise<BackupMeta> {
    const databasePath = this.getDatabasePathOrThrow();
    const config = await this.getStoredConfig();
    const trigger = options.trigger ?? 'manual';
    const compress = options.compress ?? config.compress;
    const filename = this.buildFilename(trigger, compress);
    const filePath = this.resolveBackupPath(filename);

    if (compress) {
      writeFileSync(filePath, gzipSync(readFileSync(databasePath)));
    } else {
      copyFileSync(databasePath, filePath);
    }

    const backup = this.parseBackupFilename(filename);
    if (!backup) {
      throw new BadRequestException('备份文件元数据无效');
    }

    return backup;
  }

  async restoreBackup(dto: RestoreBackupDto) {
    const databasePath = this.getDatabasePathOrThrow();
    const filePath = this.resolveBackupPath(dto.filename);

    if (!existsSync(filePath)) {
      throw new NotFoundException('备份文件不存在');
    }

    if (dto.filename.endsWith('.gz')) {
      writeFileSync(databasePath, gunzipSync(readFileSync(filePath)));
    } else {
      copyFileSync(filePath, databasePath);
    }

    return {
      success: true,
      message: `Database restored from ${dto.filename}. Please restart the server.`,
    };
  }

  async deleteBackup(filename: string) {
    const filePath = this.resolveBackupPath(filename);

    if (!existsSync(filePath)) {
      throw new NotFoundException('备份文件不存在');
    }

    this.removeFile(filePath);
    return { success: true };
  }

  async downloadBackup(filename: string) {
    const filePath = this.resolveBackupPath(filename);

    if (!existsSync(filePath)) {
      throw new NotFoundException('备份文件不存在');
    }

    const file = createReadStream(filePath);
    return new StreamableFile(file, {
      type: filename.endsWith('.gz')
        ? 'application/gzip'
        : 'application/octet-stream',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
