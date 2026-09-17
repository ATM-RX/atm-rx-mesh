import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createMeshApp } from '../src/server/app.js';
import { MockBrokerDriver } from '../src/broker/drivers/mock.js';
import { BrokerLedger } from '../src/broker/ledger.js';
import { MeshAgentClient } from '../src/client/mesh-client.js';

export async function runE2ETests(): Promise<boolean> {
  console.log('--- Testing Full End-to-End Mesh Gateway Flow ---');
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

  const UPSTREAM_PORT = 4031;
  const GATEWAY_PORT = 4032;

  // 1. Setup Mock Upstream Tool Provider
  const upstreamApp = new Hono();
  upstreamApp.get('/public', (c) => {
    return c.json({ service: 'weather-api', data: '72F Sunny' });
  });

  upstreamApp.post('/protected', async (c) => {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('L402 ')) {
      c.header(
        'WWW-Authenticate',
        'L402 macaroon="upstream_sample_macaroon_abc", invoice="lnbc1u1pupstream100sats"'
      );
      return c.json(
        {
          error: 'Payment Required',
          amountSats: 100,
          invoice: 'lnbc1u1pupstream100sats',
          macaroon: 'upstream_sample_macaroon_abc'
        },
        402
      );
    }

    // Verify token contains macaroon and preimage
    const token = auth.replace('L402 ', '');
    const [mac, preimage] = token.split(':');
    if (!mac || !preimage) {
      return c.json({ error: 'Invalid L402 credentials' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    return c.json({
      status: 'success',
      upstreamSecretData: 'CLASSIFIED_TOOL_EXECUTION_RESULT',
      receivedPayload: body
    });
  });

  const upstreamServer = serve({
    fetch: upstreamApp.fetch,
    port: UPSTREAM_PORT
  });

  // 2. Setup Mesh Clearinghouse Gateway
  const ledger = new BrokerLedger();
  const driver = new MockBrokerDriver();
  const gatewayApp = createMeshApp({
    rootKey: 'test_secret_root_key_2026_atm_rx',
    driver,
    ledger,
    policy: {
      takeRatePercent: 0.05, // 5% fee
      minTollSats: 1,
      maxAllowedUpstreamSats: 1000
    }
  });

  const gatewayServer = serve({
    fetch: gatewayApp.fetch,
    port: GATEWAY_PORT
  });

  try {
    // Wait brief moment for servers to bind
    await new Promise((r) => setTimeout(r, 200));

    const client = new MeshAgentClient({
      meshGatewayUrl: `http://127.0.0.1:${GATEWAY_PORT}`,
      maxFeeSats: 200
    });

    // Test 1: Transparent pass-through of free endpoint
    const res1 = await client.fetch(`http://127.0.0.1:${UPSTREAM_PORT}/public`);
    assert(res1.status === 200, 'Public endpoint returns 200 OK without payment challenge');
    assert(res1.data.data === '72F Sunny', 'Public payload correctly relayed');

    // Test 2: Intercept 402, levy 5% take-rate, settle, return payload
    const res2 = await client.fetch(`http://127.0.0.1:${UPSTREAM_PORT}/protected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'execute_complex_agent_task' })
    });

    assert(res2.status === 200, 'Protected endpoint settled and returned 200 OK');
    assert(res2.data.upstreamSecretData === 'CLASSIFIED_TOOL_EXECUTION_RESULT', 'Upstream secret data verified');
    assert(res2.spread?.upstreamCostSats === 100, 'Upstream cost was 100 sats');
    assert(res2.spread?.protocolFeeSats === 5, 'Protocol fee captured was 5 sats (5%)');
    assert(res2.spread?.totalBilledSats === 105, 'Total billed was 105 sats');

    // Test 3: Gateway Stats & Protocol Fee Telemetry
    const stats = ledger.getStats();
    assert(stats.totalProcessedRequests === 1, 'Clearinghouse processed 1 paid request');
    assert(stats.totalFeesCapturedSats === 5, 'Clearinghouse captured 5 sats protocol profit');
    assert(stats.totalVolumeSats === 105, 'Clearinghouse tracked 105 sats gross volume');

    // Test 4: Agent Budget Ceiling Security Halt
    const frugalClient = new MeshAgentClient({
      meshGatewayUrl: `http://127.0.0.1:${GATEWAY_PORT}`,
      maxFeeSats: 50 // Too low for 105 sats
    });

    let budgetHalted = false;
    try {
      await frugalClient.fetch(`http://127.0.0.1:${UPSTREAM_PORT}/protected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'should_fail_due_to_cost' })
      });
    } catch (err: any) {
      budgetHalted = true;
      assert(err.message.includes('[SECURITY HALT]'), 'Budget guard halted execution before payment');
    }
    assert(budgetHalted, 'Budget guard successfully protected agent funds');
  } catch (err: any) {
    console.error(`E2E test error: ${err.message}`);
    failed++;
  } finally {
    upstreamServer.close();
    gatewayServer.close();
  }

  console.log(`E2E Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
