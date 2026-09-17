import { BrokerLedger } from '../src/broker/ledger.js';
import { EscrowRecord } from '../src/types.js';

export async function runLedgerTests(): Promise<boolean> {
  console.log('--- Testing Broker Ledger & Replay Defense ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ ${msg}`);
      failed++;
    }
  }

  try {
    const ledger = new BrokerLedger();
    const hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    const record: EscrowRecord = {
      brokerPaymentHash: hash,
      upstreamPaymentHash: hash,
      upstreamBolt11: 'lnbc100n1p...',
      targetUrl: 'https://api.upstream.com/data',
      targetMethod: 'POST',
      spread: {
        upstreamAmountSats: 100,
        protocolFeeSats: 5,
        totalBilledSats: 105,
        takeRatePercent: 0.05
      },
      status: 'PENDING_AGENT_PAYMENT',
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 300
    };

    // 1. Record Escrow
    ledger.recordEscrow(record);
    const retrieved = ledger.getEscrow(hash);
    assert(!!retrieved, 'Escrow recorded and retrieved');
    assert(ledger.getStats().activeEscrows === 1, 'Active escrows incremented to 1');

    // 2. Commit Settlement
    const commit = ledger.atomicCommitSettlement(hash, 'broker_preimage_123', 'upstream_preimage_456');
    assert(commit.success === true, 'Atomic settlement committed successfully');
    assert(ledger.getEscrow(hash)?.status === 'SETTLED', 'Status transitioned to SETTLED');
    assert(ledger.getStats().activeEscrows === 0, 'Active escrows decremented to 0');
    assert(ledger.getStats().totalFeesCapturedSats === 5, 'Protocol fee of 5 sats recorded in stats');
    assert(ledger.getStats().totalVolumeSats === 105, 'Total volume of 105 sats recorded in stats');

    // 3. Replay Defense
    const replayAttempt = ledger.atomicCommitSettlement(hash, 'broker_preimage_123', 'upstream_preimage_456');
    assert(replayAttempt.success === false, 'Replay attempt blocked');
    assert(replayAttempt.reason?.includes('already been consumed') === true, 'Correct replay error reason');

    // 4. Expiration Handling
    const expiredHash = 'expired_hash_1111111111111111111111111111111111111111111111111111';
    ledger.recordEscrow({
      brokerPaymentHash: expiredHash,
      upstreamPaymentHash: expiredHash,
      upstreamBolt11: 'lnbc...',
      targetUrl: 'https://api.upstream.com',
      targetMethod: 'GET',
      spread: { upstreamAmountSats: 50, protocolFeeSats: 3, totalBilledSats: 53, takeRatePercent: 0.05 },
      status: 'PENDING_AGENT_PAYMENT',
      createdAt: Math.floor(Date.now() / 1000) - 600,
      expiresAt: Math.floor(Date.now() / 1000) - 100 // In the past
    });

    const expiredCommit = ledger.atomicCommitSettlement(expiredHash, 'pre_a', 'pre_b');
    assert(expiredCommit.success === false, 'Expired contract rejected');
    assert(expiredCommit.reason?.includes('expired') === true, 'Expiration reason reported');
  } catch (err: any) {
    console.error(`Ledger test error: ${err.message}`);
    failed++;
  }

  console.log(`Ledger Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
