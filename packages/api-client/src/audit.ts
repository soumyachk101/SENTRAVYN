import type { AuditEventView } from '@sentravyn/shared-types';
import type { Requester } from './http';

/**
 * Query params for GET /admin/audit (backend/src/audit/audit.controller.ts
 * AuditListQuery; the global ValidationPipe forbids undeclared params).
 */
export interface AuditListParams {
  /** 1-200; default 100 when omitted. */
  limit?: number;
  /** Entity filter, e.g. 'alert', 'shelter', 'dataProvider', 'session'. */
  entity?: string;
}

/**
 * Read-only admin audit endpoint (SECURITY.md 6). ADMIN-only: requests
 * from lesser roles reject 403; a stale or missing access token rejects 401.
 */
export interface AuditClient {
  /** GET /admin/audit. Most recent events, newest first. */
  list(params: AuditListParams, accessToken: string): Promise<AuditEventView[]>;
}

export function createAuditClient(req: Requester): AuditClient {
  return {
    list: (params, accessToken) => {
      const query = new URLSearchParams();
      if (params.limit !== undefined) query.set('limit', String(params.limit));
      if (params.entity !== undefined) query.set('entity', params.entity);
      const qs = query.toString();
      const path =
        qs !== '' ? `/api/v1/admin/audit?${qs}` : '/api/v1/admin/audit';
      return req.requestAuthed<AuditEventView[]>('GET', path, accessToken);
    },
  };
}
