import { decodeBolt11Amount } from '../broker/spread.js';

export interface MeshClientOptions {
  meshGatewayUrl?: string; // Default: https://atm-rx-mesh.workers.dev
  maxFeeSats?: number;     // Agent's maximum allowed spend per call (default: 100 sats)
  verbose?: boolean;
  settleInvoice?: (bolt11: string, amountSats: number) => Promise<string>; // Returns preimage
}

export interface MeshFetchResult {
  status: number;
  headers: Headers;
  data: any;
  spread?: {
    upstreamCostSats: number;
    protocolFeeSats: number;
    totalBilledSats: number;
  };
}

/**
 * Sovereign AI Agent Mesh Client
 * Drop-in wrapper that routes tool calls through the ATM-RX Mesh clearinghouse.
 */
export class MeshAgentClient {
  private gatewayUrl: string;
  private maxFeeSats: number;
  private verbose: boolean;
  private customSettler?: (bolt11: string, amountSats: number) => Promise<string>;

  constructor(options?: MeshClientOptions) {
    this.gatewayUrl = (options?.meshGatewayUrl || 'https://atm-rx-mesh.workers.dev').replace(/\/$/, '');
    this.maxFeeSats = options?.maxFeeSats ?? 100;
    this.verbose = options?.verbose ?? false;
    this.customSettler = options?.settleInvoice;
  }

  private log(msg: string) {
    if (this.verbose) console.log(`[ATM-RX-MESH-AGENT] ${msg}`);
  }

  public async fetch(targetUrl: string, init?: RequestInit): Promise<MeshFetchResult> {
    const proxyUrl = `${this.gatewayUrl}/v1/proxy?url=${encodeURIComponent(targetUrl)}`;
    const method = (init?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers || {});

    this.log(`Routing ${method} ${targetUrl} via Mesh Gateway (${this.gatewayUrl})...`);

    // Step 1: Execute initial probe request
    const initialRes = await fetch(proxyUrl, {
      method,
      headers,
      body: init?.body
    });

    if (initialRes.status !== 402) {
      let data: any;
      const contentType = initialRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await initialRes.json();
      } else {
        data = await initialRes.text();
      }
      return {
        status: initialRes.status,
        headers: initialRes.headers,
        data
      };
    }

    // Step 2: Handle Mesh Clearinghouse 402 Challenge
    this.log(`Mesh Clearinghouse L402 challenge received.`);
    const authHeader = initialRes.headers.get('WWW-Authenticate') || '';
    let macaroonStr = '';
    let invoiceStr = '';
    let mockPreimage: string | undefined;
    let spreadInfo: any;

    const macMatch = authHeader.match(/macaroon="([^"]+)"/);
    const invMatch = authHeader.match(/invoice="([^"]+)"/);

    if (macMatch) macaroonStr = macMatch[1];
    if (invMatch) invoiceStr = invMatch[1];

    try {
      const jsonBody: any = await initialRes.json();
      if (!macaroonStr && jsonBody.macaroon) macaroonStr = jsonBody.macaroon;
      if (!invoiceStr && jsonBody.invoice) invoiceStr = jsonBody.invoice;
      if (jsonBody.preimage) mockPreimage = jsonBody.preimage;
      if (jsonBody.spread) spreadInfo = jsonBody.spread;
    } catch {}

    if (!macaroonStr || !invoiceStr) {
      throw new Error('Malformed Mesh 402 challenge: Missing macaroon or invoice.');
    }

    const totalBilledSats = spreadInfo?.totalBilledSats || decodeBolt11Amount(invoiceStr) || 10;
    this.log(`Total billed sats (including protocol spread): ${totalBilledSats} sats`);

    // Step 3: Budget Guard Check
    if (totalBilledSats > this.maxFeeSats) {
      throw new Error(
        `[SECURITY HALT] Total required settlement of ${totalBilledSats} sats exceeds agent ceiling of ${this.maxFeeSats} sats`
      );
    }

    // Step 4: Settle Invoice (Mock sandbox or Custom Settler)
    let preimage = '';
    if (mockPreimage) {
      this.log(`Using sandbox test preimage from broker.`);
      preimage = mockPreimage;
    } else if (this.customSettler) {
      this.log(`Executing payment via custom agent Lightning settler...`);
      preimage = await this.customSettler(invoiceStr, totalBilledSats);
    } else {
      throw new Error(
        `Live payment required for invoice '${invoiceStr.slice(0, 20)}...'. Provide a settleInvoice handler to MeshAgentClient.`
      );
    }

    // Step 5: Re-execute with Authorization: L402
    this.log(`Re-executing with Authorization: L402 <token>`);
    headers.set('Authorization', `L402 ${macaroonStr}:${preimage}`);

    const finalRes = await fetch(proxyUrl, {
      method,
      headers,
      body: init?.body
    });

    let finalData: any;
    const finalContentType = finalRes.headers.get('content-type') || '';
    if (finalContentType.includes('application/json')) {
      finalData = await finalRes.json();
    } else {
      finalData = await finalRes.text();
    }

    return {
      status: finalRes.status,
      headers: finalRes.headers,
      data: finalData,
      spread: spreadInfo
    };
  }
}
