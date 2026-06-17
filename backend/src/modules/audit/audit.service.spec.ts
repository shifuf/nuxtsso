import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('returns paginated logs and applies skip/take', async () => {
    const createdAt = new Date('2026-06-08T01:02:03.000Z');
    const prismaService = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'log-1',
            action: 'auth.login.password',
            actorId: 'user-1',
            actorEmail: 'user@example.com',
            targetId: null,
            applicationId: null,
            ip: '127.0.0.1',
            userAgent: 'jest',
            metadata: '{"ok":true}',
            createdAt,
            actor: {
              username: 'user',
              role: 'USER',
            },
          },
        ]),
        count: jest.fn().mockResolvedValue(42),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const service = new AuditService(prismaService as never);

    const result = await service.listLogs({ page: 2, pageSize: 20 });

    expect(prismaService.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
      }),
    );
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'log-1',
          category: 'auth',
          metadata: { ok: true },
          actorRole: 'user',
          createdAt,
        }),
      ],
      total: 42,
      page: 2,
      pageSize: 20,
    });
  });
});
