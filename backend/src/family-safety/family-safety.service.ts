import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateEmergencyContactDto,
  CreateLocationShareDto,
  UpdateEmergencyContactDto,
  UpdateHouseholdPlanDto,
} from './family-safety.dto';

/**
 * Family-safety service (Phase 7, SECURITY.md 5).
 *
 * Object-level authorisation: every read and mutation scopes the query by
 * the authenticated user's own id (passed in by the controller from
 * `request.user`); there is no route that takes another user's id. When a
 * caller requests a resource id that is not theirs, the scoped lookup finds
 * nothing and the service returns 404 - a 404 by design, so the API does not
 * even confirm that another user's record exists.
 *
 * Privacy (SECURITY.md 5): location shares store only what is needed -
 * purpose, recipient, bounded expiry, revocation, and a COARSE last-known
 * position. Precise coordinates are never persisted, and no location value
 * (coarse or otherwise) is ever written to the audit log: audit detail
 * records the share id and the transition, not the position.
 */
export interface EmergencyContactView {
  id: string;
  name: string;
  relation: string | null;
  phone: string | null;
  consent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationShareView {
  id: string;
  recipient: string;
  purpose: string;
  preciseConsent: boolean;
  lastKnownLat: number | null;
  lastKnownLng: number | null;
  lastKnownAt: string | null;
  expiresAt: string;
  revoked: boolean;
  revokedAt: string | null;
  createdAt: string;
  /**
   * Computed read-time flag: active = consented and not revoked and not
   * expired. Never stored; callers must not assume a stored state.
   */
  active: boolean;
}

export interface HouseholdPlanView {
  id: string;
  meetingPoint: string | null;
  meetingPointNote: string | null;
  kitChecklist: { label: string; done: boolean }[];
  petConsiderations: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class FamilySafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------- emergency contacts

  /** Maps a persisted contact row (Prisma row or equivalent shape) to the API view. */
  private contactViewOf(r: {
    id: string;
    name: string;
    relation: string | null;
    phone: string | null;
    consent: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): EmergencyContactView {
    return {
      id: r.id,
      name: r.name,
      relation: r.relation,
      phone: r.phone,
      consent: r.consent,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async listContacts(userId: string): Promise<EmergencyContactView[]> {
    const rows = await this.prisma.emergencyContact.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.contactViewOf(r));
  }

  async createContact(
    userId: string,
    dto: CreateEmergencyContactDto,
  ): Promise<EmergencyContactView> {
    // Prisma `create` returns the full persisted row: no re-fetch needed.
    const row = await this.prisma.emergencyContact.create({
      data: {
        userId,
        name: dto.name,
        relation: dto.relation ?? null,
        phone: dto.phone ?? null,
        consent: dto.consent ?? false,
      },
    });
    await this.audit.record(
      userId,
      'FAMILY_CONTACT_CREATED',
      'EmergencyContact',
      row.id,
      JSON.stringify({ name: row.name }),
    );
    return this.contactViewOf(row);
  }

  /**
   * Update one of the user's own contacts. The lookup is scoped to userId,
   * so another user's id is a 404 (never a 403 that confirms existence).
   */
  async updateContact(
    userId: string,
    contactId: string,
    dto: UpdateEmergencyContactDto,
  ): Promise<EmergencyContactView> {
    const owned = await this.ownContact(userId, contactId);
    // Prisma `update` returns the full persisted row: map it directly.
    const row = await this.prisma.emergencyContact.update({
      where: { id: owned.id },
      data: {
        name: dto.name ?? owned.name,
        relation: dto.relation !== undefined ? dto.relation : owned.relation,
        phone: dto.phone !== undefined ? dto.phone : owned.phone,
        consent: dto.consent !== undefined ? dto.consent : owned.consent,
      },
    });
    await this.audit.record(
      userId,
      'FAMILY_CONTACT_UPDATED',
      'EmergencyContact',
      row.id,
      JSON.stringify({ name: row.name }),
    );
    return this.contactViewOf(row);
  }

  /** Delete one of the user's own contacts; 404 when not owned. */
  async deleteContact(userId: string, contactId: string): Promise<void> {
    const owned = await this.ownContact(userId, contactId);
    await this.prisma.emergencyContact.delete({ where: { id: owned.id } });
    await this.audit.record(
      userId,
      'FAMILY_CONTACT_DELETED',
      'EmergencyContact',
      contactId,
      undefined,
    );
  }

  private async ownContact(userId: string, contactId: string) {
    const row = await this.prisma.emergencyContact.findFirst({
      where: { id: contactId, userId },
    });
    if (!row) {
      // Unknown-or-not-mine: one answer for both, by design (404, not 403).
      throw new NotFoundException('Emergency contact not found');
    }
    return row;
  }

  // ---------------------------------------------------------- location shares

  async listShares(
    userId: string,
    now: Date = new Date(),
  ): Promise<LocationShareView[]> {
    const rows = await this.prisma.locationShare.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.shareView(r, now));
  }

  /**
   * Location shares store a COARSE last-known position only (rounded to
   * ~110 m). No precise coordinate is ever persisted, and no location value
   * reaches the audit log or any other log (SECURITY.md 5: privacy
   * minimisation - no exact user location in analytics or logs without
   * explicit consent and a documented need; there is none here).
   */
  async createShare(
    userId: string,
    dto: CreateLocationShareDto,
  ): Promise<LocationShareView> {
    const now = new Date();
    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= now.getTime()) {
      // A share that expires at or before creation is a logic error, not a
      // consent: reject it instead of storing a dead grant.
      throw new NotFoundException('Location share must outlive its creation');
    }

    let lat: number | null = null;
    let lng: number | null = null;
    let lastKnownAt: Date | null = null;
    if (dto.lastKnownLat !== undefined && dto.lastKnownLng !== undefined) {
      const parsedLat = Number(dto.lastKnownLat);
      const parsedLng = Number(dto.lastKnownLng);
      if (
        Number.isNaN(parsedLat) ||
        Number.isNaN(parsedLng) ||
        Math.abs(parsedLat) > 90 ||
        Math.abs(parsedLng) > 180
      ) {
        throw new NotFoundException('Coarse location is out of range');
      }
      // Store only the coarse value: round to 1e-3 degrees (~110 m) so a
      // precise coordinate can never be persisted even if a client sends one.
      lat = Math.round(parsedLat * 1000) / 1000;
      lng = Math.round(parsedLng * 1000) / 1000;
      lastKnownAt = now;
    }

    const row = await this.prisma.locationShare.create({
      data: {
        userId,
        recipient: dto.recipient,
        purpose: dto.purpose,
        preciseConsent: dto.preciseConsent ?? false,
        lastKnownLat: lat,
        lastKnownLng: lng,
        lastKnownAt,
        expiresAt,
        consented: true, // created only through explicit consent (SECURITY.md 5)
      },
    });
    // Audit the grant, NOT the position: SECURITY.md 5 forbids location data
    // in logs/analytics. Detail records only the consent scope.
    await this.audit.record(
      userId,
      'LOCATION_SHARE_CREATED',
      'LocationShare',
      row.id,
      JSON.stringify({
        recipient: row.recipient,
        purpose: row.purpose,
        preciseConsent: row.preciseConsent,
        expiresAt: row.expiresAt.toISOString(),
      }),
    );
    return this.shareView(row, now);
  }

  /**
   * Revoke one of the user's own shares, immediately and irreversibly.
   * Revocation is a security-relevant mutation: it is audited (the event
   * records the transition, not any position).
   */
  async revokeShare(
    userId: string,
    shareId: string,
  ): Promise<LocationShareView> {
    const owned = await this.ownShare(userId, shareId);
    const now = new Date();
    const row = await this.prisma.locationShare.update({
      where: { id: owned.id },
      data: { revoked: true, revokedAt: now, consented: false },
    });
    await this.audit.record(
      userId,
      'LOCATION_SHARE_REVOKED',
      'LocationShare',
      shareId,
      JSON.stringify({ revokedAt: now.toISOString() }),
    );
    return this.shareView(row, now);
  }

  private async ownShare(userId: string, shareId: string) {
    const row = await this.prisma.locationShare.findFirst({
      where: { id: shareId, userId },
    });
    if (!row) {
      throw new NotFoundException('Location share not found');
    }
    return row;
  }

  private shareView(
    r: {
      id: string;
      recipient: string;
      purpose: string;
      preciseConsent: boolean;
      lastKnownLat: number | null;
      lastKnownLng: number | null;
      lastKnownAt: Date | null;
      consented: boolean;
      expiresAt: Date;
      revoked: boolean;
      revokedAt: Date | null;
      createdAt: Date;
    },
    now: Date,
  ): LocationShareView {
    const active =
      r.consented && !r.revoked && now.getTime() < r.expiresAt.getTime();
    return {
      id: r.id,
      recipient: r.recipient,
      purpose: r.purpose,
      preciseConsent: r.preciseConsent,
      lastKnownLat: r.lastKnownLat,
      lastKnownLng: r.lastKnownLng,
      lastKnownAt: r.lastKnownAt ? r.lastKnownAt.toISOString() : null,
      expiresAt: r.expiresAt.toISOString(),
      revoked: r.revoked,
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      active,
    };
  }

  // ---------------------------------------------------------- household plan

  async getHouseholdPlan(userId: string): Promise<HouseholdPlanView | null> {
    const row = await this.prisma.householdPlan.findUnique({
      where: { userId },
    });
    return row ? this.planView(row) : null;
  }

  /**
   * Upsert the user's own household plan. All fields are optional; omitted
   * fields keep their current value (create: stay null / empty). This is
   * preparedness data the user maintains about themselves - it is never a
   * live operational claim and requires no review.
   */
  async upsertHouseholdPlan(
    userId: string,
    dto: UpdateHouseholdPlanDto,
  ): Promise<HouseholdPlanView> {
    const kit =
      dto.kitChecklist === undefined
        ? undefined
        : dto.kitChecklist.map((i) => ({ label: i.label, done: i.done }));

    const row = await this.prisma.householdPlan.upsert({
      where: { userId },
      create: {
        userId,
        meetingPoint: dto.meetingPoint ?? null,
        meetingPointNote: dto.meetingPointNote ?? null,
        kitChecklist: (kit ?? []) as unknown as Prisma.JsonArray,
        petConsiderations: dto.petConsiderations ?? null,
      },
      update: {
        ...(dto.meetingPoint !== undefined
          ? { meetingPoint: dto.meetingPoint }
          : {}),
        ...(dto.meetingPointNote !== undefined
          ? { meetingPointNote: dto.meetingPointNote }
          : {}),
        ...(kit !== undefined
          ? { kitChecklist: kit as unknown as Prisma.JsonArray }
          : {}),
        ...(dto.petConsiderations !== undefined
          ? { petConsiderations: dto.petConsiderations }
          : {}),
      },
    });
    await this.audit.record(
      userId,
      'HOUSEHOLD_PLAN_UPDATED',
      'HouseholdPlan',
      row.id,
      undefined, // preparedness detail is the user's own private data: not logged
    );
    return this.planView(row);
  }

  private planView(r: {
    id: string;
    meetingPoint: string | null;
    meetingPointNote: string | null;
    kitChecklist: Prisma.JsonValue;
    petConsiderations: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): HouseholdPlanView {
    // The column is user-controlled JSON, shaped by the DTO at write time.
    // Defensive coercion here so a hand-edited row can never crash a read.
    const raw = r.kitChecklist;
    const list = Array.isArray(raw) ? raw : [];
    const kitChecklist = list
      .filter((i): i is { label: string; done: boolean } => {
        return (
          typeof i === 'object' &&
          i !== null &&
          typeof (i as Record<string, unknown>).label === 'string' &&
          typeof (i as Record<string, unknown>).done === 'boolean'
        );
      })
      .map((i) => ({ label: i.label, done: i.done }));
    return {
      id: r.id,
      meetingPoint: r.meetingPoint,
      meetingPointNote: r.meetingPointNote,
      kitChecklist,
      petConsiderations: r.petConsiderations,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
