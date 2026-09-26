import { runSpreadTests } from './spread.test.js';
import { runLedgerTests } from './ledger.test.js';
import { runE2ETests } from './e2e.test.js';
import { runLinearTests } from './linear.test.js';

async function main() {
  console.log(`\n========================================================`);
  console.log(`⚡ ATM-RX MESH CLEARINGHOUSE - AUTOMATED TEST RUNNER ⚡`);
  console.log(`========================================================\n`);

  const spreadSuccess = await runSpreadTests();
  const ledgerSuccess = await runLedgerTests();
  const e2eSuccess = await runE2ETests();
  const linearSuccess = await runLinearTests();

  if (spreadSuccess && ledgerSuccess && e2eSuccess && linearSuccess) {
    console.log(`🎉 ALL TESTS PASSED (100% SUCCESS)`);
    process.exit(0);
  } else {
    console.error(`💥 TEST RUNNER FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
