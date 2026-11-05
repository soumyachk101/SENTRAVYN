import { AuditService, AUDIT_ACTIONS } from '../src/audit/audit.service';

describe('AuditService', () => {
  function build() {
    const auditEventCreate = jest.fn().mockResolvedValue({});
    // only auditEvent delegate is used by these tests; never is the minimal type escape
    const service = new AuditService({ auditEvent: { create: auditEventCreate } } as never);
    return { service, auditEventCreate };
  }

  it('record() writes an AuditEvent with the right fields', async () => {
    const { service, auditEventCreate } = build();

    await service.record('user-1', AUDIT_ACTIONS.ALERT_PUBLISHED, 'Alert', 'alert-9', 'published');

    expect(auditEventCreate).toHaveBeenCalledTimes(1);
    expect(auditEventCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        action: 'ALERT_PUBLISHED',
        entity: 'Alert',
        entityId: 'alert-9',
        detail: 'published',
      },
    });
  });

  it('record() passes null actor through for system-driven actions', async () => {
    const { service, auditEventCreate } = build();

    await service.record(null, AUDIT_ACTIONS.PROVIDER_CHANGED, 'Provider', 'p-1');

    expect(auditEventCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: null,
        action: 'PROVIDER_CHANGED',
        entity: 'Provider',
        entityId: 'p-1',
        detail: null,
      },
    });
  });

  it('record() caps detail at exactly 2000 chars', async () => {
    const { service, auditEventCreate } = build();
    const detail = 'x'.repeat(2500);

    await service.record(null, AUDIT_ACTIONS.ALERT_CANCELLED, 'Alert', 'a-2', detail);

    const call = auditEventCreate.mock.calls[0][0];
    expect(call.data.detail).toHaveLength(2000);
    expect(call.data.detail).toBe('x'.repeat(2000));
  });

  it('AUDIT_ACTIONS contains the 10 canonical keys', () => {
    expect(Object.keys(AUDIT_ACTIONS).sort()).toEqual(
      [
        'ALERT_CANCELLED',
        'ALERT_PUBLISHED',
        'ALERT_UPDATED',
        'PLACE_EVIDENCE_ADDED',
        'PROVIDER_CHANGED',
        'SESSION_REFRESHED',
        'SESSION_REVOKED',
        'SHELTER_REJECTED',
        'SHELTER_VERIFIED',
        'USER_ROLE_CHANGED',
      ].sort(),
    );
  });
});
