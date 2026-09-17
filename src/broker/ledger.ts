import { EscrowRecord, TelemetryStats } from '../types.js';

/**
 * Atomic Single-Flight Broker Escrow Ledger
 * Ensures exact-once settlement and protects against replay attacks.
 */
export class BrokerLedger {
  private escrows = new Map<string, EscrowRecord>();
  private stats: TelemetryStats = {
    totalProcessedRequests: 0,
    totalVolumeSats: 0,
    totalFeesCapturedSats: 0,
    activeEscrows: 0
  };

  public recordEscrow(record: EscrowRecord): void {
    this.escrows.set(record.brokerPaymentHash, record);
    this.stats.activeEscrows++;
  }

  public getEscrow(brokerPaymentHash: string): EscrowRecord | undefined {
    return this.escrows.get(brokerPaymentHash);
  }

  public atomicCommitSettlement(
    brokerPaymentHash: string,
    brokerPreimage: string,
    upstreamPreimage: string
  ): { success: boolean; reason?: string; record?: EscrowRecord } {
    const record = this.escrows.get(brokerPaymentHash);
    const now = Math.floor(Date.now() / 1000);

    if (!record) {
      return { success: false, reason: 'Escrow contract not found in broker ledger' };
    }

    if (record.status === 'SETTLED') {
      return { success: false, reason: 'Payment hash has already been consumed (replay attempt)' };
    }

    if (now > record.expiresAt) {
      record.status = 'EXPIRED';
      this.stats.activeEscrows = Math.max(0, this.stats.activeEscrows - 1);
      return { success: false, reason: 'Escrow contract has expired' };
    }

    // Atomic state transition
    record.status = 'SETTLED';
    record.settledAt = now;
    record.brokerPreimage = brokerPreimage;
    record.upstreamPreimage = upstreamPreimage;

    this.stats.activeEscrows = Math.max(0, this.stats.activeEscrows - 1);
    this.stats.totalProcessedRequests++;
    this.stats.totalVolumeSats += record.spread.totalBilledSats;
    this.stats.totalFeesCapturedSats += record.spread.protocolFeeSats;

    return { success: true, record };
  }

  public getStats(): TelemetryStats {
    return { ...this.stats };
  }
}
