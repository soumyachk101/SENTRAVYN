import { createHash } from 'node:crypto';
import type { RawSourceRecord } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/** SHA-256 hex digest of the UTF-8 encoding of a raw payload. */
export function payloadHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export interface UpsertRawRecordInput {
  providerId: string;
  sourceId: string;
  sourceUrl?: string;
  rawPayload: string;
  fetchedAt: Date;
}

export interface UpsertRawRecordResult {
  record: RawSourceRecord;
  created: boolean;
}

/**
 * Idempotent ingestion of a raw source record (ADR-007).
 *
 * Looks up the most recent RawSourceRecord for (providerId, sourceId). If it
 * already carries the payload hash of `input.rawPayload`, it is a replay:
 * the existing row is returned as-is with `created: false` and never
 * mutated. Otherwise a new immutable row is created.
 *
 * The Prisma client is injected so the function is unit testable with a
 * stub; the prisma client itself is never held by this module.
 */
export async function upsertRawRecord(
  prisma: PrismaService,
  input: UpsertRawRecordInput,
): Promise<UpsertRawRecordResult> {
  const hash = payloadHash(input.rawPayload);

  const existing = await prisma.rawSourceRecord.findFirst({
    where: { providerId: input.providerId, sourceId: input.sourceId },
    orderBy: { ingestedAt: 'desc' },
  });
  if (existing && existing.payloadHash === hash) {
    return { record: existing, created: false };
  }

  const record = await prisma.rawSourceRecord.create({
    data: {
      providerId: input.providerId,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl ?? null,
      payloadHash: hash,
      rawPayload: input.rawPayload,
      fetchedAt: input.fetchedAt,
    },
  });
  return { record, created: true };
}
