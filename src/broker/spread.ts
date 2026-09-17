import { FeePolicy, SpreadBreakdown } from '../types.js';

/**
 * Lightweight Bolt11 satoshi decoder
 */
export function decodeBolt11Amount(invoice: string): number | null {
  const match = invoice.toLowerCase().match(/^lnbc([0-9]+)([munp]?)/);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  const multiplier = match[2];

  if (isNaN(num)) return null;

  switch (multiplier) {
    case 'm': // milli (0.001 BTC = 100,000 sats)
      return num * 100000;
    case 'u': // micro (0.000001 BTC = 100 sats)
      return num * 100;
    case 'n': // nano (0.000000001 BTC = 0.1 sats)
      return Math.round(num * 0.1);
    case 'p': // pico (0.000000000001 BTC = 0.0001 sats)
      return Math.round(num * 0.0001);
    default:
      // No multiplier means BTC
      return num * 100000000;
  }
}

/**
 * Protocol Take-Rate Calculation Engine
 * Guarantees mathematical floor (minTollSats) and ceiling bounds.
 */
export function calculateSpread(
  upstreamAmountSats: number,
  policy: FeePolicy
): SpreadBreakdown {
  if (upstreamAmountSats <= 0) {
    throw new Error('Invalid upstream invoice amount: must be greater than 0 sats');
  }

  if (policy.maxAllowedUpstreamSats && upstreamAmountSats > policy.maxAllowedUpstreamSats) {
    throw new Error(
      `[SECURITY HALT] Upstream invoice of ${upstreamAmountSats} sats exceeds broker ceiling of ${policy.maxAllowedUpstreamSats} sats`
    );
  }

  const rawFee = Math.ceil(upstreamAmountSats * policy.takeRatePercent);
  const protocolFeeSats = Math.max(policy.minTollSats, rawFee);
  const totalBilledSats = upstreamAmountSats + protocolFeeSats;

  return {
    upstreamAmountSats,
    protocolFeeSats,
    totalBilledSats,
    takeRatePercent: policy.takeRatePercent
  };
}
