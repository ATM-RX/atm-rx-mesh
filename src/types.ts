/**
 * Domain Types for ATM-RX Mesh Clearinghouse
 * Author: Brandon Binion (ATM-RX)
 */

export interface FeePolicy {
  takeRatePercent: number; // e.g. 0.05 for 5%
  minTollSats: number;     // e.g. 1 sat minimum
  maxAllowedUpstreamSats?: number; // e.g. 5000 sats ceiling
}

export interface SpreadBreakdown {
  upstreamAmountSats: number;
  protocolFeeSats: number;
  totalBilledSats: number;
  takeRatePercent: number;
}

export interface UpstreamChallenge {
  rawHeader: string;
  macaroon?: string;
  invoice: string;
  amountSats: number;
  paymentHash: string;
}

export interface WrappedInvoice {
  brokerPaymentHash: string;
  brokerPaymentRequest: string; // Bolt11 invoice to pay Rex
  brokerMacaroon: string;
  upstreamPaymentHash: string;
  upstreamBolt11: string;
  spread: SpreadBreakdown;
  expiresAt: number;
  targetUrl: string;
  targetMethod: string;
}

export type EscrowStatus = 'PENDING_AGENT_PAYMENT' | 'SETTLED' | 'FAILED' | 'EXPIRED';

export interface EscrowRecord {
  brokerPaymentHash: string;
  upstreamPaymentHash: string;
  upstreamBolt11: string;
  targetUrl: string;
  targetMethod: string;
  spread: SpreadBreakdown;
  status: EscrowStatus;
  createdAt: number;
  expiresAt: number;
  settledAt?: number;
  brokerPreimage?: string;
  upstreamPreimage?: string;
  upstreamMacaroon?: string;
}

export interface BrokerSettlementDriver {
  name: string;
  createBrokerInvoice(
    totalAmountSats: number,
    memo: string,
    ttlSeconds?: number
  ): Promise<{ paymentHash: string; paymentRequest: string; preimage?: string }>;
  verifyAgentPayment(paymentHash: string, preimage: string): Promise<boolean>;
  settleUpstreamInvoice(
    upstreamBolt11: string,
    amountSats: number
  ): Promise<{ success: boolean; preimage?: string; error?: string }>;
}

export interface Caveat {
  key: string;
  value: string;
}

export interface Macaroon {
  version: number;
  location: string;
  identifier: string; // payment_hash
  caveats: Caveat[];
  signature: string; // HMAC-SHA256 hex
}

export interface TelemetryStats {
  totalProcessedRequests: number;
  totalVolumeSats: number;
  totalFeesCapturedSats: number;
  activeEscrows: number;
}
