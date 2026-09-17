import { Buffer } from 'node:buffer';
import { Caveat, Macaroon } from '../types.js';
import { hmacSha256, constantTimeEqual } from './crypto.js';

/**
 * L402 Macaroon Engine for Wrapped Broker Tokens
 */

export function mintMacaroon(
  rootKey: string,
  identifier: string, // broker_payment_hash
  location: string,
  caveats: Caveat[] = []
): Macaroon {
  let currentSig = hmacSha256(rootKey, identifier);

  for (const c of caveats) {
    const serializedCaveat = `${c.key}=${c.value}`;
    currentSig = hmacSha256(Buffer.from(currentSig, 'hex'), serializedCaveat);
  }

  return {
    version: 1,
    location,
    identifier,
    caveats,
    signature: currentSig
  };
}

export function serializeMacaroon(macaroon: Macaroon): string {
  const json = JSON.stringify(macaroon);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function deserializeMacaroon(raw: string): Macaroon {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (
      !parsed ||
      typeof parsed.identifier !== 'string' ||
      !Array.isArray(parsed.caveats) ||
      typeof parsed.signature !== 'string'
    ) {
      throw new Error('Malformed macaroon structure');
    }
    return parsed as Macaroon;
  } catch (err: any) {
    throw new Error(`Failed to deserialize macaroon: ${err.message}`);
  }
}

export function verifyMacaroon(
  rootKey: string,
  macaroon: Macaroon,
  context: {
    targetUrl: string;
    targetMethod: string;
    nowSeconds?: number;
  }
): { valid: boolean; reason?: string } {
  const now = context.nowSeconds ?? Math.floor(Date.now() / 1000);

  // 1. Recompute cryptographic signature chain
  let expectedSig = hmacSha256(rootKey, macaroon.identifier);

  for (const c of macaroon.caveats) {
    const serializedCaveat = `${c.key}=${c.value}`;
    expectedSig = hmacSha256(Buffer.from(expectedSig, 'hex'), serializedCaveat);

    // 2. Evaluate caveats
    if (c.key === 'time_before') {
      const expiresAt = parseInt(c.value, 10);
      if (isNaN(expiresAt) || now > expiresAt) {
        return { valid: false, reason: `Macaroon expired at ${expiresAt}, current time is ${now}` };
      }
    } else if (c.key === 'target_url') {
      if (c.value !== context.targetUrl) {
        return { valid: false, reason: `Target mismatch: caveat requires '${c.value}', requested '${context.targetUrl}'` };
      }
    } else if (c.key === 'target_method') {
      if (c.value !== '*' && c.value.toUpperCase() !== context.targetMethod.toUpperCase()) {
        return { valid: false, reason: `Method mismatch: caveat requires '${c.value}', requested '${context.targetMethod}'` };
      }
    }
  }

  // 3. Constant-time signature verification
  if (!constantTimeEqual(macaroon.signature, expectedSig)) {
    return { valid: false, reason: 'Invalid cryptographic signature' };
  }

  return { valid: true };
}
