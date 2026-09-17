import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { serve } from '@hono/node-server';
import { createMeshApp } from './server/app.js';
import { BrokerLedger } from './broker/ledger.js';
import { MockBrokerDriver } from './broker/drivers/mock.js';
import { LNbitsBrokerDriver } from './broker/drivers/lnbits.js';
import { BrokerSettlementDriver, FeePolicy } from './types.js';
import { calculateSpread } from './broker/spread.js';
import { MeshAgentClient } from './client/mesh-client.js';

dotenv.config();

// Global HTTP proxy compliance for tethered/proxied environments
const proxyUrl = process.env.https_proxy || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const program = new Command();

program
  .name('atm-rx-mesh')
  .description('⚡ ATM-RX Mesh: Sovereign AI Agent Tool Gateway & Clearinghouse with Protocol Take-Rate')
  .version('1.0.0');

// Command: serve
program
  .command('serve')
  .description('Start the local Mesh Gateway Clearinghouse server')
  .option('-p, --port <number>', 'Port to listen on', '4021')
  .option('-d, --driver <type>', 'Settlement driver (mock | lnbits)', process.env.SETTLEMENT_DRIVER || 'mock')
  .option('-r, --take-rate <percent>', 'Take-rate protocol fee percent (e.g. 0.05 for 5%)', process.env.TAKE_RATE_PERCENT || '0.05')
  .option('-m, --min-toll <sats>', 'Minimum protocol fee toll in satoshis', process.env.MIN_TOLL_SATS || '1')
  .action((options) => {
    const port = parseInt(options.port, 10);
    const rootKey = process.env.MESH_ROOT_KEY || 'sovereign_mesh_dev_root_key_atm_rx_2026';
    const policy: FeePolicy = {
      takeRatePercent: parseFloat(options.takeRate),
      minTollSats: parseInt(options.minToll, 10),
      maxAllowedUpstreamSats: 10000
    };

    let driver: BrokerSettlementDriver;
    if (options.driver === 'lnbits' && process.env.LNBITS_API_URL && process.env.LNBITS_INVOICE_KEY) {
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
  });

// Command: fetch
program
  .command('fetch <targetUrl>')
  .description('Route an agent HTTP request through the Mesh Clearinghouse')
  .option('-g, --gateway <url>', 'Mesh Gateway URL', process.env.MESH_GATEWAY_URL || 'http://localhost:4021')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <data>', 'Request body')
  .option('-H, --header <header...>', 'Custom headers (Key: Value)')
  .option('-f, --max-fee <sats>', 'Agent maximum fee ceiling in satoshis', '100')
  .option('-v, --verbose', 'Verbose agent logging', false)
  .action(async (targetUrl, options) => {
    try {
      const client = new MeshAgentClient({
        meshGatewayUrl: options.gateway,
        maxFeeSats: parseInt(options.maxFee, 10),
        verbose: options.verbose
      });

      const headers: Record<string, string> = {};
      if (options.header) {
        for (const h of options.header) {
          const idx = h.indexOf(':');
          if (idx !== -1) {
            headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
          }
        }
      }

      console.log(`\n⚡ Dispatching tool request via Mesh Gateway: ${options.gateway}`);
      console.log(`⚡ Target Upstream: ${options.method.toUpperCase()} ${targetUrl}\n`);

      const result = await client.fetch(targetUrl, {
        method: options.method,
        headers,
        body: options.body
      });

      console.log(`\n───────────────── MESH CLEARINGHOUSE RECEIPT ─────────────────`);
      console.log(`Status: ${result.status}`);
      if (result.spread) {
        console.log(`Upstream Cost:    ${result.spread.upstreamCostSats} sats`);
        console.log(`Protocol Fee Cut: ${result.spread.protocolFeeSats} sats`);
        console.log(`Total Billed:     ${result.spread.totalBilledSats} sats`);
      }
      console.log(`─────────────────────────────────────────────────────────────`);
      console.log(`Response Payload:\n`, typeof result.data === 'object' ? JSON.stringify(result.data, null, 2) : result.data);
    } catch (err: any) {
      console.error(`\n❌ Error routing tool call: ${err.message}`);
      process.exit(1);
    }
  });

// Command: stats
program
  .command('stats')
  .description('Inspect live clearinghouse metrics, volume, and captured protocol fees')
  .option('-g, --gateway <url>', 'Mesh Gateway URL', process.env.MESH_GATEWAY_URL || 'http://localhost:4021')
  .action(async (options) => {
    try {
      const statsUrl = `${options.gateway.replace(/\/$/, '')}/v1/stats`;
      const res = await fetch(statsUrl);
      if (!res.ok) {
        throw new Error(`Gateway returned HTTP ${res.status}: ${await res.text()}`);
      }
      const data: any = await res.json();
      console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
      console.log(`║           ATM-RX MESH: CLEARINGHOUSE TELEMETRY               ║`);
      console.log(`╚══════════════════════════════════════════════════════════════╝`);
      console.log(`⚡ Operator:            ${data.operator}`);
      console.log(`⚡ Clearinghouse:       ${data.clearinghouse}`);
      console.log(`⚡ Protocol Take-Rate:  ${(data.policy.takeRatePercent * 100).toFixed(1)}% (min ${data.policy.minTollSats} sat)`);
      console.log(`⚡ Total Requests:      ${data.stats.totalProcessedRequests}`);
      console.log(`⚡ Gross Volume:        ${data.stats.totalVolumeSats} sats`);
      console.log(`⚡ Protocol Fees Rex:   ${data.stats.totalFeesCapturedSats} sats`);
      console.log(`⚡ Active Escrows:      ${data.stats.activeEscrows}`);
      console.log(`⚡ Last Updated:        ${data.timestamp}\n`);
    } catch (err: any) {
      console.error(`\n❌ Failed to query gateway stats: ${err.message}`);
      process.exit(1);
    }
  });

// Command: calc-spread
program
  .command('calc-spread <upstreamSats>')
  .description('Calculate protocol fee spread for a given upstream tool price')
  .option('-r, --take-rate <percent>', 'Take-rate protocol fee percent', '0.05')
  .option('-m, --min-toll <sats>', 'Minimum protocol fee toll in satoshis', '1')
  .action((upstreamSatsStr, options) => {
    const upstreamSats = parseInt(upstreamSatsStr, 10);
    const policy: FeePolicy = {
      takeRatePercent: parseFloat(options.takeRate),
      minTollSats: parseInt(options.minToll, 10)
    };
    const spread = calculateSpread(upstreamSats, policy);
    console.log(`\n───────────────── SPREAD BREAKDOWN ─────────────────`);
    console.log(`Upstream Service Price:   ${spread.upstreamAmountSats} sats`);
    console.log(`ATM-RX Take-Rate Fee:     ${spread.protocolFeeSats} sats (${(spread.takeRatePercent * 100).toFixed(1)}%)`);
    console.log(`Total Billed to Agent:    ${spread.totalBilledSats} sats`);
    console.log(`────────────────────────────────────────────────────\n`);
  });

program.parse(process.argv);
