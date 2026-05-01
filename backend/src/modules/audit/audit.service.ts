import { Injectable } from '@nestjs/common';
import { Prisma, type UserRole } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PrismaService } from '../../database/prisma.service';

const AUDIT_CATEGORY_PREFIXES = ['auth', 'oauth2', 'admin'] as const;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type AuditCategory = (typeof AUDIT_CATEGORY_PREFIXES)[number] | 'system';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  actorEmail?: string | null;
  targetId?: string | null;
  applicationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class ListAuditLogsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsIn(AUDIT_CATEGORY_PREFIXES)
  category?: Exclude<AuditCategory, 'system'>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}

export class AuditSummaryQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number = 7;
}

interface AuditLogRecord {
  id: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  targetId: string | null;
  applicationId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: string | null;
  createdAt: Date;
  actor?: {
    username: string | null;
    role: UserRole;
  } | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prismaService: PrismaService) {}

  private parseMetadata(metadata: string | null) {
    if (!metadata) {
      return null;
    }

    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return {
        raw: metadata,
      };
    }
  }

  private resolveCategory(action: string): AuditCategory {
    const prefix = action.split('.')[0] as AuditCategory;
    return AUDIT_CATEGORY_PREFIXES.includes(prefix as Exclude<AuditCategory, 'system'>)
      ? prefix
      : 'system';
  }

  private toApiAuditLog(log: AuditLogRecord) {
    return {
      id: log.id,
      action: log.action,
      category: this.resolveCategory(log.action),
      actorId: log.actorId,
      actorEmail: log.actorEmail,
      actorName: log.actor?.username ?? null,
      actorRole: log.actor?.role?.toLowerCase() ?? null,
      targetId: log.targetId,
      applicationId: log.applicationId,
      ip: log.ip,
      userAgent: log.userAgent,
      metadata: this.parseMetadata(log.metadata),
      createdAt: log.createdAt,
    };
  }

  private buildWhere(dto: ListAuditLogsDto): Prisma.AuditLogWhereInput | undefined {
    const conditions: Prisma.AuditLogWhereInput[] = [];

    if (dto.category) {
      conditions.push({
        action: {
          startsWith: `${dto.category}.`,
        },
      });
    }

    if (dto.action) {
      conditions.push({
        action: {
          contains: dto.action,
        },
      });
    }

    if (dto.q) {
      conditions.push({
        OR: [
          {
            action: {
              contains: dto.q,
            },
          },
          {
            actorEmail: {
              contains: dto.q,
            },
          },
          {
            targetId: {
              contains: dto.q,
            },
          },
          {
            applicationId: {
              contains: dto.q,
            },
          },
          {
            ip: {
              contains: dto.q,
            },
          },
          {
            metadata: {
              contains: dto.q,
            },
          },
          {
            actor: {
              is: {
                OR: [
                  {
                    username: {
                      contains: dto.q,
                    },
                  },
                  {
                    email: {
                      contains: dto.q,
                    },
                  },
                ],
              },
            },
          },
        ],
      });
    }

    if (!conditions.length) {
      return undefined;
    }

    return {
      AND: conditions,
    };
  }

  async create(entry: AuditEntry) {
    return this.prismaService.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? undefined,
        actorEmail: entry.actorEmail ?? undefined,
        targetId: entry.targetId ?? undefined,
        applicationId: entry.applicationId ?? undefined,
        ip: entry.ip ?? undefined,
        userAgent: entry.userAgent ?? undefined,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined,
      },
    });
  }

  async listLogs(dto: ListAuditLogsDto) {
    const logs = await this.prismaService.auditLog.findMany({
      where: this.buildWhere(dto),
      include: {
        actor: {
          select: {
            username: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: dto.limit ?? 30,
    });

    return logs.map((log) => this.toApiAuditLog(log));
  }

  async getSummary(dto: AuditSummaryQueryDto) {
    const windowDays = dto.days ?? 7;
    const since = new Date(Date.now() - windowDays * DAY_IN_MS);
    const last24Hours = new Date(Date.now() - DAY_IN_MS);
    const logs = await this.prismaService.auditLog.findMany({
      where: {
        createdAt: {
          gte: since,
        },
      },
      select: {
        action: true,
        actorId: true,
        createdAt: true,
      },
    });

    const actionCounts = new Map<string, number>();
    const uniqueActors = new Set<string>();
    let recentEvents = 0;
    let identityEvents = 0;
    let adminEvents = 0;

    for (const log of logs) {
      actionCounts.set(log.action, (actionCounts.get(log.action) ?? 0) + 1);

      if (log.actorId) {
        uniqueActors.add(log.actorId);
      }

      if (log.createdAt.getTime() >= last24Hours.getTime()) {
        recentEvents += 1;
      }

      if (log.action.startsWith('admin.')) {
        adminEvents += 1;
      }

      if (log.action.startsWith('auth.') || log.action.startsWith('oauth2.')) {
        identityEvents += 1;
      }
    }

    return {
      windowDays,
      total: logs.length,
      last24Hours: recentEvents,
      identityEvents,
      adminEvents,
      uniqueActors: uniqueActors.size,
      topActions: Array.from(actionCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([action, count]) => ({
          action,
          count,
          category: this.resolveCategory(action),
        })),
    };
  }
}
