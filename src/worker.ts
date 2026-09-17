import { Buffer } from 'node:buffer';

// Defensive shims for Cloudflare Workers isolate
if (typeof (globalThis as any).Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}
if (typeof (globalThis as any).process === 'undefined') {
  (globalThis as any).process = {
    env: {},
    uptime: () => 0,
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
    platform: 'linux'
  };
}

import { createMeshApp } from './server/app.js';
import { BrokerLedger } from './broker/ledger.js';
import { MockBrokerDriver } from './broker/drivers/mock.js';
import { LNbitsBrokerDriver } from './broker/drivers/lnbits.js';
import { BrokerSettlementDriver, FeePolicy } from './types.js';

export interface Env {
  MESH_ROOT_KEY?: string;
  SETTLEMENT_DRIVER?: string;
  LNBITS_API_URL?: string;
  LNBITS_INVOICE_KEY?: string;
  LNBITS_ADMIN_KEY?: string;
  TAKE_RATE_PERCENT?: string;
  MIN_TOLL_SATS?: string;
}

// Global in-memory ledger instance for isolate
const edgeLedger = new BrokerLedger();

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const rootKey = env.MESH_ROOT_KEY || 'sovereign_mesh_edge_root_key_atm_rx_2026';
    const driverMode = env.SETTLEMENT_DRIVER || 'mock';

    const policy: FeePolicy = {
      takeRatePercent: parseFloat(env.TAKE_RATE_PERCENT || '0.05'),
      minTollSats: parseInt(env.MIN_TOLL_SATS || '1', 10),
      maxAllowedUpstreamSats: 10000
    };

    let driver: BrokerSettlementDriver;
    if (driverMode === 'lnbits' && env.LNBITS_API_URL && env.LNBITS_INVOICE_KEY) {
      driver = new LNbitsBrokerDriver({
        baseUrl: env.LNBITS_API_URL,
        invoiceKey: env.LNBITS_INVOICE_KEY,
        adminKey: env.LNBITS_ADMIN_KEY
      });
    } else {
      driver = new MockBrokerDriver();
    }

    const app = createMeshApp({
      rootKey,
      driver,
      ledger: edgeLedger,
      policy
    });

    return app.fetch(request, env, ctx);
  }
};
