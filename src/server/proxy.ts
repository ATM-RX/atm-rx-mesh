import { Context, Handler } from 'hono';
import { BrokerLedger } from '../broker/ledger.js';
import { BrokerSettlementDriver, FeePolicy, WrappedInvoice } from '../types.js';
import { calculateSpread, decodeBolt11Amount } from '../broker/spread.js';
import { deserializeMacaroon, mintMacaroon, serializeMacaroon, verifyMacaroon } from '../core/macaroon.js';

export interface ProxyConfig {
  rootKey: string;
  driver: BrokerSettlementDriver;
  ledger: BrokerLedger;
  policy: FeePolicy;
}

/**
 * ATM-RX Mesh: Intercepting Reverse Proxy & Clearinghouse Handler
 */
export function createProxyHandler(config: ProxyConfig): Handler {
  const { rootKey, driver, ledger, policy } = config;

  return async (c: Context) => {
    // 1. Resolve target upstream URL
    let targetUrl = c.req.header('X-Target-Url') || c.req.query('url') || c.req.query('target');

    if (!targetUrl) {
      return c.json(
        {
          error: 'Missing target URL',
          usage: {
            viaHeader: 'X-Target-Url: https://api.example.com/v1/resource',
            viaQueryParam: '/v1/proxy?url=https%3A%2F%2Fapi.example.com%2Fv1%2Fresource'
          }
        },
        400
      );
    }

    const method = c.req.method.toUpperCase();
    const authHeader = c.req.header('Authorization');

    // 2. Prepare forward headers (strictly strip hop-by-hop and Cloudflare edge loop headers)
    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.header())) {
      const lower = key.toLowerCase();
      if (
        !['host', 'x-target-url', 'authorization', 'connection', 'accept-encoding'].includes(lower) &&
        !lower.startsWith('cf-') &&
        !lower.startsWith('x-forwarded-') &&
        !lower.startsWith('x-real-')
      ) {
        forwardHeaders[key] = value;
      }
    }
    forwardHeaders['user-agent'] = c.req.header('user-agent') || 'ATM-RX-Mesh/1.0';

    let requestBody: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        requestBody = await c.req.text();
      } catch {}
    }

    // =========================================================================
    // CASE A: Unauthenticated Request -> Probe Upstream for 402 Challenge
    // =========================================================================
    if (!authHeader || (!authHeader.startsWith('L402 ') && !authHeader.startsWith('LSAT '))) {
      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(targetUrl, {
          method,
          headers: forwardHeaders,
          body: requestBody
        });
      } catch (err: any) {
        return c.json({ error: `Upstream unreachable: ${err.message}`, targetUrl }, 502);
      }

      // If upstream does not require payment, transparently forward response
      if (upstreamRes.status !== 402) {
        const bodyText = await upstreamRes.text();
        const resHeaders: Record<string, string> = {};
        upstreamRes.headers.forEach((v, k) => {
          resHeaders[k] = v;
        });
        return new Response(bodyText, {
          status: upstreamRes.status,
          headers: resHeaders
        });
      }

      // 402 Payment Required Detected from Upstream
      const upstreamAuthHeader = upstreamRes.headers.get('WWW-Authenticate') || '';
      let upstreamMacaroon = '';
      let upstreamInvoice = '';
      let upstreamSats = 0;

      const macMatch = upstreamAuthHeader.match(/macaroon="([^"]+)"/);
      const invMatch = upstreamAuthHeader.match(/invoice="([^"]+)"/);

      if (macMatch) upstreamMacaroon = macMatch[1];
      if (invMatch) upstreamInvoice = invMatch[1];

      // Parse JSON fallback if present
      try {
        const jsonBody: any = await upstreamRes.json();
        if (!upstreamMacaroon && jsonBody.macaroon) upstreamMacaroon = jsonBody.macaroon;
        if (!upstreamInvoice && jsonBody.invoice) upstreamInvoice = jsonBody.invoice;
        if (jsonBody.amountSats) upstreamSats = jsonBody.amountSats;
      } catch {}

      if (!upstreamInvoice) {
        return c.json({ error: 'Malformed upstream 402 challenge: Missing Bolt11 invoice' }, 502);
      }

      if (!upstreamSats) {
        const decoded = decodeBolt11Amount(upstreamInvoice);
        upstreamSats = decoded || 10;
      }

      // Calculate Protocol Take-Rate
      const spread = calculateSpread(upstreamSats, policy);
      const ttlSeconds = 600;
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

      // Generate Wrapped Invoice on Rex's Treasury Wallet
      const brokerInvoice = await driver.createBrokerInvoice(
        spread.totalBilledSats,
        `ATM-RX Mesh: ${spread.totalBilledSats} sats (includes ${spread.protocolFeeSats} sats fee)`,
        ttlSeconds
      );

      // Mint Wrapped Macaroon
      const caveats = [
        { key: 'time_before', value: expiresAt.toString() },
        { key: 'target_url', value: targetUrl },
        { key: 'target_method', value: method },
        { key: 'upstream_hash', value: brokerInvoice.paymentHash },
        { key: 'fee_sats', value: spread.protocolFeeSats.toString() }
      ];

      const macaroon = mintMacaroon(rootKey, brokerInvoice.paymentHash, c.req.url, caveats);
      const serializedMacaroon = serializeMacaroon(macaroon);

      // Record Escrow in Ledger
      ledger.recordEscrow({
        brokerPaymentHash: brokerInvoice.paymentHash,
        upstreamPaymentHash: brokerInvoice.paymentHash,
        upstreamBolt11: upstreamInvoice,
        upstreamMacaroon: upstreamMacaroon || undefined,
        targetUrl,
        targetMethod: method,
        spread,
        status: 'PENDING_AGENT_PAYMENT',
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt
      });

      c.header('WWW-Authenticate', `L402 macaroon="${serializedMacaroon}", invoice="${brokerInvoice.paymentRequest}"`);
      return c.json(
        {
          status: 'Payment Required',
          clearinghouse: 'ATM-RX Mesh Gateway',
          targetUrl,
          spread: {
            upstreamCostSats: spread.upstreamAmountSats,
            protocolFeeSats: spread.protocolFeeSats,
            totalBilledSats: spread.totalBilledSats,
            takeRatePercent: `${(spread.takeRatePercent * 100).toFixed(1)}%`
          },
          invoice: brokerInvoice.paymentRequest,
          macaroon: serializedMacaroon,
          preimage: brokerInvoice.preimage // Available in mock sandbox mode
        },
        402
      );
    }

    // =========================================================================
    // CASE B: Authenticated Request -> Verify Broker Payment & Settle Upstream
    // =========================================================================
    const tokenPart = authHeader.replace(/^(L402|LSAT)\s+/, '').trim();
    const [rawMacaroon, brokerPreimage] = tokenPart.split(':');

    if (!rawMacaroon || !brokerPreimage) {
      return c.json({ error: 'Malformed L402 Authorization. Expected: Authorization: L402 <macaroon>:<preimage>' }, 401);
    }

    // 1. Verify Wrapped Macaroon Cryptographic Integrity
    let macaroon;
    try {
      macaroon = deserializeMacaroon(rawMacaroon);
    } catch (err: any) {
      return c.json({ error: `Invalid Macaroon: ${err.message}` }, 401);
    }

    const verification = verifyMacaroon(rootKey, macaroon, {
      targetUrl,
      targetMethod: method
    });

    if (!verification.valid) {
      return c.json({ error: `Broker token rejected: ${verification.reason}` }, 401);
    }

    const brokerPaymentHash = macaroon.identifier;

    // 2. Verify Agent paid Rex's Treasury Wallet
    const agentPaid = await driver.verifyAgentPayment(brokerPaymentHash, brokerPreimage);
    if (!agentPaid) {
      return c.json({ error: 'Payment verification failed: Broker invoice unpaid or invalid preimage' }, 402);
    }

    // 3. Lookup Escrow Record
    const escrow = ledger.getEscrow(brokerPaymentHash);
    if (!escrow) {
      return c.json({ error: 'Escrow contract not found in broker ledger' }, 404);
    }

    // 4. Settle Upstream Invoice using Broker Wallet
    const settlement = await driver.settleUpstreamInvoice(
      escrow.upstreamBolt11,
      escrow.spread.upstreamAmountSats
    );

    if (!settlement.success || !settlement.preimage) {
      return c.json(
        {
          error: 'Broker upstream settlement failed',
          details: settlement.error || 'Upstream provider could not be settled'
        },
        502
      );
    }

    // 5. Atomic Commit: Single-flight spend lock (prevents double-spend replay)
    const commit = ledger.atomicCommitSettlement(
      brokerPaymentHash,
      brokerPreimage,
      settlement.preimage
    );

    if (!commit.success) {
      return c.json({ error: `Authorization rejected: ${commit.reason}` }, 409);
    }

    // 6. Forward Request to Upstream with Upstream Preimage
    const upstreamAuth = escrow.upstreamMacaroon
      ? `L402 ${escrow.upstreamMacaroon}:${settlement.preimage}`
      : `L402 ${escrow.brokerPaymentHash}:${settlement.preimage}`;
    forwardHeaders['Authorization'] = upstreamAuth;

    let finalRes: Response;
    try {
      finalRes = await fetch(targetUrl, {
        method,
        headers: forwardHeaders,
        body: requestBody
      });
    } catch (err: any) {
      return c.json({ error: `Upstream error after settlement: ${err.message}` }, 502);
    }

    const finalBodyText = await finalRes.text();
    const finalHeaders: Record<string, string> = {};
    finalRes.headers.forEach((v, k) => {
      finalHeaders[k] = v;
    });

    // Append clearinghouse settlement telemetry headers
    finalHeaders['X-Mesh-Status'] = 'SETTLED';
    finalHeaders['X-Mesh-Protocol-Fee-Sats'] = escrow.spread.protocolFeeSats.toString();
    finalHeaders['X-Mesh-Upstream-Sats'] = escrow.spread.upstreamAmountSats.toString();

    return new Response(finalBodyText, {
      status: finalRes.status,
      headers: finalHeaders
    });
  };
}
