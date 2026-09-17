import { calculateSpread, decodeBolt11Amount } from '../src/broker/spread.js';
import { FeePolicy } from '../src/types.js';

export async function runSpreadTests(): Promise<boolean> {
  console.log('--- Testing Protocol Fee Spread Engine ---');
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
    // 1. Standard 5% take-rate on 100 sats
    const policy1: FeePolicy = { takeRatePercent: 0.05, minTollSats: 1 };
    const spread1 = calculateSpread(100, policy1);
    assert(spread1.upstreamAmountSats === 100, 'Upstream amount is 100 sats');
    assert(spread1.protocolFeeSats === 5, 'Protocol fee is exactly 5 sats (5% of 100)');
    assert(spread1.totalBilledSats === 105, 'Total billed is 105 sats');

    // 2. Min-toll floor on small amounts
    const spread2 = calculateSpread(10, policy1);
    // 5% of 10 = 0.5 sats -> rounded to 1 sat minToll
    assert(spread2.upstreamAmountSats === 10, 'Upstream amount is 10 sats');
    assert(spread2.protocolFeeSats === 1, 'Protocol fee enforces minToll floor of 1 sat');
    assert(spread2.totalBilledSats === 11, 'Total billed is 11 sats');

    // 3. Higher take-rate (15%) on 500 sats
    const policy2: FeePolicy = { takeRatePercent: 0.15, minTollSats: 2 };
    const spread3 = calculateSpread(500, policy2);
    assert(spread3.protocolFeeSats === 75, 'Protocol fee is 75 sats (15% of 500)');
    assert(spread3.totalBilledSats === 575, 'Total billed is 575 sats');

    // 4. Ceiling enforcement
    const policyCeiling: FeePolicy = { takeRatePercent: 0.05, minTollSats: 1, maxAllowedUpstreamSats: 1000 };
    let ceilingError = false;
    try {
      calculateSpread(2000, policyCeiling);
    } catch (e: any) {
      ceilingError = true;
      assert(e.message.includes('exceeds broker ceiling'), 'Ceiling overflow correctly rejected');
    }
    assert(ceilingError, 'Upstream amount exceeding ceiling threw an error');

    // 5. Bolt11 amount decoder
    const decodedAmount = decodeBolt11Amount('lnbc100n1p3xxxx');
    assert(decodedAmount === 10, 'Decoded 100n satoshis correctly to 10 sats');

    const decodedAmountU = decodeBolt11Amount('lnbc1u1p3xxxx');
    assert(decodedAmountU === 100, 'Decoded 1u satoshis correctly to 100 sats');
  } catch (err: any) {
    console.error(`Spread test error: ${err.message}`);
    failed++;
  }

  console.log(`Spread Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
