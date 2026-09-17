import { Hono } from 'hono';
import { BrokerLedger } from '../broker/ledger.js';
import { BrokerSettlementDriver, FeePolicy } from '../types.js';
import { createProxyHandler } from './proxy.js';

export interface AppConfig {
  rootKey: string;
  driver: BrokerSettlementDriver;
  ledger: BrokerLedger;
  policy: FeePolicy;
}

export function createMeshApp(config: AppConfig) {
  const app = new Hono();
  const { driver, ledger, policy } = config;

  // 1. Root / Node Discovery
  app.get('/', (c) => {
    return c.json({
      name: 'atm-rx-mesh',
      version: '1.0.0',
      description: 'Sovereign AI Agent Tool Gateway & Clearinghouse',
      operator: 'ATM-RX (Brandon Binion)',
      driver: driver.name,
      takeRatePercent: `${(policy.takeRatePercent * 100).toFixed(1)}%`,
      minTollSats: policy.minTollSats,
      endpoints: {
        public: ['/health', '/v1/stats'],
        proxy: '/v1/proxy?url={target_url}'
      }
    });
  });

  // 2. Health & Telemetry Check (Edge Isolate Safe)
  app.get('/health', (c) => {
    const hasProcess = typeof process !== 'undefined';
    const mem = hasProcess && typeof process.memoryUsage === 'function' ? process.memoryUsage() : null;
    const uptime = hasProcess && typeof process.uptime === 'function' ? Math.floor(process.uptime()) : null;

    return c.json({
      status: 'operational',
      runtime: typeof navigator !== 'undefined' && (navigator as any).userAgent ? (navigator as any).userAgent : 'edge-isolate',
      uptimeSeconds: uptime,
      memory: mem
        ? {
            rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
            heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2))
          }
        : { edgeIsolate: 'managed_by_cloudflare' },
      driver: driver.name,
      timestamp: new Date().toISOString()
    });
  });

  // 3. Live Clearinghouse Volume & Spread Metrics
  app.get('/v1/stats', (c) => {
    return c.json({
      success: true,
      clearinghouse: 'ATM-RX Mesh Treasury',
      operator: 'ATM-RX (Brandon Binion)',
      policy: {
        takeRatePercent: policy.takeRatePercent,
        minTollSats: policy.minTollSats
      },
      stats: ledger.getStats(),
      timestamp: new Date().toISOString()
    });
  });

  // 4. Intercepting Reverse Proxy (Accepts GET, POST, PUT, DELETE, PATCH, HEAD)
  app.all('/v1/proxy', createProxyHandler(config));

  return app;
}
