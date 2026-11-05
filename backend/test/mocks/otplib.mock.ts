import { createHmac, randomBytes } from 'crypto';

/**
 * Functional otplib mock for Jest (the installed otplib 13.x line is ESM-
 * first and its ESM transitive (@scure/base) does not load under Jest's
 * CJS runtime; the production runtime loads it natively, so this mock is
 * test-environment-only).
 *
 * It mirrors otplib 13's flat API surface used by MfaService and implements
 * REAL RFC 6238 TOTP (HMAC-SHA1, base32 seed) via node:crypto, so tests
 * round-trip genuine codes against genuine seeds rather than stubs. Error
 * shapes match otplib: a wrong-length token raises an error whose message
 * contains "Token must be", and an invalid base32 seed raises an error whose
 * message contains "Invalid Base32 string" — both are relied on by
 * MfaService's fail-closed paths.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decodes a base32 string (RFC 4648) to bytes. Throws on invalid input. */
function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  if (clean.length === 0) {
    throw new Error('Invalid Base32 string: empty input.');
  }
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Invalid Base32 string: Unknown letter "${ch}". Allowed: ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Encodes bytes to uppercase base32 without padding (matches otplib seeds). */
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function hotp(secretBytes: Uint8Array, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export interface VerifyRecord {
  valid: boolean;
  delta: number;
  epoch: number;
  timeStep: number;
}

/** generateSecret(options?) — otplib flat API. */
export function generateSecret(options?: { length?: number }): string {
  const length = options?.length ?? 20;
  return base32Encode(new Uint8Array(randomBytes(length)));
}

/** generateURI(options) — otplib flat API (minimal TOTP query params). */
export function generateURI(options: {
  strategy?: string;
  issuer: string;
  label: string;
  secret: string;
  period?: number;
  digits?: number;
  counter?: number;
}): string {
  const type = options.strategy === 'hotp' ? 'hotp' : 'totp';
  const query =
    `secret=${options.secret}&issuer=${encodeURIComponent(options.issuer)}` +
    (type === 'totp'
      ? `&digits=${options.digits ?? 6}&period=${options.period ?? 30}`
      : `&counter=${options.counter ?? 0}&digits=${options.digits ?? 6}`);
  return `otpauth://${type}/${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.label)}?${query}`;
}

/** Shared synchronous verification core (used by both sync and async). */
function verifyCore(options: {
  token: string;
  secret: string;
  strategy?: string;
  period?: number;
  digits?: number;
  counter?: number;
  epochTolerance?: number;
}): VerifyRecord {
  const digits = options.digits ?? 6;
  const token = options.token;
  if (!/^\d+$/.test(token) || token.length !== digits) {
    // Mirrors otplib's TokenLengthError message contract.
    throw new Error(`Token must be ${digits} digits, got ${token.length}`);
  }
  const secretBytes = base32Decode(options.secret); // throws "Invalid Base32 string" when corrupt
  if (options.strategy === 'hotp') {
    const counter = options.counter ?? 0;
    const tolerance = options.epochTolerance ?? 0;
    for (let i = 0; i <= tolerance; i += 1) {
      if (hotp(secretBytes, counter + i, digits) === token) {
        return { valid: true, delta: i, epoch: counter + i, timeStep: counter + i };
      }
    }
    return { valid: false, delta: 0, epoch: counter, timeStep: counter };
  }
  const period = options.period ?? 30;
  const now = Math.floor(Date.now() / 1000);
  const baseCounter = Math.floor(now / period);
  const toleranceSteps = Math.max(0, Math.floor((options.epochTolerance ?? 0) / period));
  for (let offset = -toleranceSteps; offset <= toleranceSteps; offset += 1) {
    const counter = baseCounter + offset;
    if (hotp(secretBytes, counter, digits) === token) {
      return { valid: true, delta: -offset * period, epoch: now, timeStep: counter };
    }
  }
  return { valid: false, delta: 0, epoch: now, timeStep: baseCounter };
}

/** generate(options) — otplib flat API (async to match the real signature). */
export async function generate(options: {
  secret: string;
  strategy?: string;
  period?: number;
  digits?: number;
  counter?: number;
}): Promise<string> {
  const secretBytes = base32Decode(options.secret);
  if (options.strategy === 'hotp') {
    return hotp(secretBytes, options.counter ?? 0, options.digits ?? 6);
  }
  const period = options.period ?? 30;
  const counter = Math.floor(Date.now() / 1000 / period);
  return hotp(secretBytes, counter, options.digits ?? 6);
}

/** verify(options) — otplib flat API; returns { valid, delta, epoch, timeStep }. */
export async function verify(options: Parameters<typeof verifyCore>[0]): Promise<VerifyRecord> {
  return verifyCore(options);
}

/** Sync variants so a `require('otplib')`-style surface is complete. */
export function generateSync(options: Parameters<typeof generate>[0]): string {
  const secretBytes = base32Decode(options.secret);
  if (options.strategy === 'hotp') {
    return hotp(secretBytes, options.counter ?? 0, options.digits ?? 6);
  }
  const period = options.period ?? 30;
  return hotp(secretBytes, Math.floor(Date.now() / 1000 / period), options.digits ?? 6);
}

export function verifySync(options: Parameters<typeof verifyCore>[0]): VerifyRecord {
  return verifyCore(options);
}

export default {
  generateSecret,
  generateURI,
  generate,
  generateSync,
  verify,
  verifySync,
};
