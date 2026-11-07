import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Design-lock for the named throttler groups
 * (backend/src/common/throttling/throttling.module.ts):
 *
 * - The `auth` group (THROTTLE_AUTH_LIMIT, tighter + block window) must
 *   govern ONLY the credential-exchange surface: AuthController and
 *   MfaController.
 * - Every other controller must carry class-level
 *   `@SkipThrottle({ auth: true })` so it is governed by the general
 *   `default` limit only.
 *
 * Omitting that skip was a real defect: the places / guides /
 * family / notifications controllers (added in Phases 4-7) were missing it,
 * so a PUBLIC read route was co-governed by the 15/min credential group.
 * Under load that 429'd the public surface — and, before the Redis ms/s
 * units fix, opened multi-day blocks. This spec walks the controller
 * sources and fails if any controller drifts out of the design.
 */

const SRC = join(__dirname, '..', 'src');

/** Credential-exchange surface: governed by the `auth` group, must NOT skip. */
const CREDENTIAL_CONTROLLERS = new Set([
  'auth/auth.controller.ts',
  'auth/mfa/mfa.controller.ts',
]);

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) controllerFiles(path, out);
    else if (entry.name.endsWith('.controller.ts')) out.push(path);
  }
  return out;
}

describe('named throttler group design (throttling-groups)', () => {
  it('enumerates every controller (non-empty tree, sanity)', () => {
    const files = controllerFiles(SRC).map((f) => f.slice(SRC.length + 1));
    expect(files.length).toBeGreaterThan(5);
    // Every file the design knows about is accounted for: credential set is a
    // subset of what exists, so a renamed/removed credential controller fails.
    for (const known of CREDENTIAL_CONTROLLERS) {
      expect(files).toContain(known);
    }
  });

  it('only the credential surface is governed by the `auth` group', () => {
    const offenders: string[] = [];
    for (const file of controllerFiles(SRC)) {
      const rel = file.slice(SRC.length + 1);
      const source = readFileSync(file, 'utf8');
      const skipsAuth = source.includes('@SkipThrottle({ auth: true })');
      if (CREDENTIAL_CONTROLLERS.has(rel)) {
        // Credential exchange stays under the tight auth limit.
        if (skipsAuth)
          offenders.push(
            `${rel} (credential controller must not skip the auth group)`,
          );
      } else if (!skipsAuth) {
        // Every other controller must be governed by `default` only.
        offenders.push(`${rel} (missing @SkipThrottle({ auth: true }))`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the SkipThrottle import is present wherever the decorator is used', () => {
    const offenders: string[] = [];
    for (const file of controllerFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      if (
        source.includes('@SkipThrottle({ auth: true })') &&
        !source.includes("from '@nestjs/throttler'")
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('throttle config remains env-overridable with the documented defaults', () => {
    const cfgPath = join(SRC, 'common/throttling/throttling.module.ts');
    expect(existsSync(cfgPath)).toBe(true);
    const source = readFileSync(cfgPath, 'utf8');
    // The documented defaults (SECURITY.md section 3): 300 default, 15 auth.
    expect(source).toContain("int('THROTTLE_DEFAULT_LIMIT', 300)");
    expect(source).toContain("int('THROTTLE_AUTH_LIMIT', 15)");
  });
});
