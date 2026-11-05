import type {
  EmergencyContactInput,
  EmergencyContactPatch,
  EmergencyContactView,
  HouseholdPlanInput,
  HouseholdPlanView,
  LocationShareInput,
  LocationShareView,
} from '@sentravyn/shared-types';
import type { Requester } from './http';

/**
 * Family-safety endpoints (Phase 7, SECURITY.md 5). Every route is
 * authenticated (object-level authorisation: the server scopes every query
 * to the owning user; a foreign resource id is a 404, never a leak).
 *
 * Privacy contract (mirrored server-side):
 * - Location shares carry explicit consent (recipient + purpose), a bounded
 *   expiry, and are revocable. `active` is computed at read time (not stored).
 * - Only a coarse last-known position is ever accepted or stored; precise
 *   coordinates are never persisted or logged.
 *
 * Access tokens are passed per call so the client stays token-agnostic,
 * matching the other Phase 2+ modules.
 */
export interface FamilyClient {
  /** GET /family/contacts. The user's own emergency contacts. */
  listContacts(accessToken: string): Promise<EmergencyContactView[]>;

  /** POST /family/contacts. Add one of the user's contacts. */
  createContact(
    input: EmergencyContactInput,
    accessToken: string,
  ): Promise<EmergencyContactView>;

  /** PATCH /family/contacts/:id. Update the user's own contact (404 when foreign). */
  updateContact(
    contactId: string,
    input: EmergencyContactPatch,
    accessToken: string,
  ): Promise<EmergencyContactView>;

  /** DELETE /family/contacts/:id. Remove the user's own contact. */
  deleteContact(
    contactId: string,
    accessToken: string,
  ): Promise<void>;

  /** GET /family/location-shares. Each row carries a computed `active` flag. */
  listLocationShares(accessToken: string): Promise<LocationShareView[]>;

  /**
   * POST /family/location-shares. Create a share with explicit consent,
   * purpose, recipient and a bounded expiry. 400 when expiresAt is at or
   * before now.
   */
  createLocationShare(
    input: LocationShareInput,
    accessToken: string,
  ): Promise<LocationShareView>;

  /** POST /family/location-shares/:id/revoke. Immediate, irreversible. */
  revokeLocationShare(
    shareId: string,
    accessToken: string,
  ): Promise<LocationShareView>;

  /**
   * GET /family/household-plan. The route always responds 200; when the user
   * has not stored a plan the body is empty, which the requester resolves to
   * undefined - normalise both to null here.
   */
  getHouseholdPlan(accessToken: string): Promise<HouseholdPlanView | null>;

  /** PUT /family/household-plan. Upsert the user's own plan. */
  upsertHouseholdPlan(
    input: HouseholdPlanInput,
    accessToken: string,
  ): Promise<HouseholdPlanView>;
}

function jsonBody<T>(body: T): { headers: Record<string, string>; body: string } {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export function createFamilyClient(req: Requester): FamilyClient {
  return {
    listContacts: (accessToken) =>
      req.requestAuthed<EmergencyContactView[]>(
        'GET',
        '/api/v1/family/contacts',
        accessToken,
      ),
    createContact: (input, accessToken) =>
      req.requestAuthed<EmergencyContactView>(
        'POST',
        '/api/v1/family/contacts',
        accessToken,
        jsonBody(input),
      ),
    updateContact: (contactId, input, accessToken) =>
      req.requestAuthed<EmergencyContactView>(
        'PATCH',
        `/api/v1/family/contacts/${encodeURIComponent(contactId)}`,
        accessToken,
        jsonBody(input),
      ),
    deleteContact: (contactId, accessToken) =>
      req.requestAuthed<void>(
        'DELETE',
        `/api/v1/family/contacts/${encodeURIComponent(contactId)}`,
        accessToken,
      ),
    listLocationShares: (accessToken) =>
      req.requestAuthed<LocationShareView[]>(
        'GET',
        '/api/v1/family/location-shares',
        accessToken,
      ),
    createLocationShare: (input, accessToken) =>
      req.requestAuthed<LocationShareView>(
        'POST',
        '/api/v1/family/location-shares',
        accessToken,
        jsonBody(input),
      ),
    revokeLocationShare: (shareId, accessToken) =>
      req.requestAuthed<LocationShareView>(
        'POST',
        `/api/v1/family/location-shares/${encodeURIComponent(shareId)}/revoke`,
        accessToken,
      ),
    getHouseholdPlan: (accessToken) =>
      req
        .requestAuthed<HouseholdPlanView | undefined>(
          'GET',
          '/api/v1/family/household-plan',
          accessToken,
        )
        .then((plan) => plan ?? null),
    upsertHouseholdPlan: (input, accessToken) =>
      req.requestAuthed<HouseholdPlanView>(
        'PUT',
        '/api/v1/family/household-plan',
        accessToken,
        jsonBody(input),
      ),
  };
}
