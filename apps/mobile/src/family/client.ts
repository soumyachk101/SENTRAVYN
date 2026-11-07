import { SentravynApiClient } from '@sentravyn/api-client';
import type {
  EmergencyContactInput,
  EmergencyContactPatch,
  HouseholdPlanInput,
  LocationShareInput,
} from '@sentravyn/shared-types';

/**
 * Mobile family-safety API client (Phase 7). Wraps the shared @sentravyn/
 * api-client family module so the mobile screens assert on the real
 * backend contract (backend/src/family-safety). Access tokens are supplied
 * per call from the app session; the client stores nothing.
 *
 * The base URL mirrors the web client (apps/web/src/lib/api.ts): an env
 * with a localhost default. Configure EXPO_PUBLIC_API_BASE_URL for a real
 * endpoint.
 */

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

let client: SentravynApiClient | null = null;
function api(): SentravynApiClient {
  if (client === null) {
    client = new SentravynApiClient({ baseUrl: API_BASE });
  }
  return client;
}

// Emergency contacts
export const familyContacts = (token: string) => api().familyContacts(token);
export const familyCreateContact = (
  input: EmergencyContactInput,
  token: string,
) => api().familyCreateContact(input, token);
export const familyUpdateContact = (
  contactId: string,
  input: EmergencyContactPatch,
  token: string,
) => api().familyUpdateContact(contactId, input, token);
export const familyDeleteContact = (contactId: string, token: string) =>
  api().familyDeleteContact(contactId, token);

// Location shares
export const familyLocationShares = (token: string) =>
  api().familyLocationShares(token);
export const familyCreateLocationShare = (
  input: LocationShareInput,
  token: string,
) => api().familyCreateLocationShare(input, token);
export const familyRevokeLocationShare = (shareId: string, token: string) =>
  api().familyRevokeLocationShare(shareId, token);

// Household plan
export const familyHouseholdPlan = (token: string) =>
  api().familyHouseholdPlan(token);
export const familyUpsertHouseholdPlan = (
  input: HouseholdPlanInput,
  token: string,
) => api().familyUpsertHouseholdPlan(input, token);
