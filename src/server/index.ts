import { serve } from '@hono/node-server';
import * as dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { createMeshApp } from './app.js';
import { BrokerLedger } from '../broker/ledger.js';
import { MockBrokerDriver } from '../broker/drivers/mock.js';
import { LNbitsBrokerDriver } from '../broker/drivers/lnbits.js';
import { BrokerSettlementDriver, FeePolicy } from '../types.js';

dotenv.config();

// Ensure global fetch respects proxy if configured
const proxyUrl = process.env.https_proxy || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const port = parseInt(process.env.PORT || '4021', 10);
const rootKey = process.env.MESH_ROOT_KEY || 'sovereign_mesh_dev_root_key_atm_rx_2026';
const driverMode = process.env.SETTLEMENT_DRIVER || 'mock';

const policy: FeePolicy = {
  takeRatePercent: parseFloat(process.env.TAKE_RATE_PERCENT || '0.05'), // 5% default
  minTollSats: parseInt(process.env.MIN_TOLL_SATS || '1', 10), // 1 sat minimum
  maxAllowedUpstreamSats: 10000
};

let driver: BrokerSettlementDriver;
if (driverMode === 'lnbits' && process.env.LNBITS_API_URL && process.env.LNBITS_INVOICE_KEY) {
  driver = new LNbitsBrokerDriver({
    baseUrl: process.env.LNBITS_API_URL,
    invoiceKey: process.env.LNBITS_INVOICE_KEY,
    adminKey: process.env.LNBITS_ADMIN_KEY
  });
} else {
  driver = new MockBrokerDriver();
}

const ledger = new BrokerLedger();
const app = createMeshApp({
  rootKey,
  driver,
  ledger,
  policy
});

console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
console.log(`║           ATM-RX MESH: AI AGENT CLEARINGHOUSE               ║`);
console.log(`╚══════════════════════════════════════════════════════════════╝`);
console.log(`⚡ Operator:       ATM-RX (Brandon Binion)`);
console.log(`⚡ Port:           ${port}`);
console.log(`⚡ Settlement:     ${driver.name.toUpperCase()}`);
console.log(`⚡ Take-Rate:      ${(policy.takeRatePercent * 100).toFixed(1)}% (min ${policy.minTollSats} sat)`);
console.log(`⚡ Proxy Endpoint: http://localhost:${port}/v1/proxy?url={target}`);
console.log(`⚡ Stats Endpoint: http://localhost:${port}/v1/stats\n`);

serve({
  fetch: app.fetch,
  port
});
