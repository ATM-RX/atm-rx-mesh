import { BrokerSettlementDriver } from '../../types.js';
import { verifyPreimage } from '../../core/crypto.js';

export interface LNbitsBrokerConfig {
  baseUrl: string;
  invoiceKey: string;
  adminKey?: string;
}

/**
 * Production LNbits Broker Clearinghouse Driver
 * Generates wrapped invoices on Rex's treasury wallet and settles upstream invoices.
 */
export class LNbitsBrokerDriver implements BrokerSettlementDriver {
  public name = 'lnbits';
  private baseUrl: string;
  private invoiceKey: string;
  private adminKey?: string;

  constructor(config: LNbitsBrokerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.invoiceKey = config.invoiceKey;
    this.adminKey = config.adminKey;
  }

  public async createBrokerInvoice(
    totalAmountSats: number,
    memo: string,
    ttlSeconds = 600
  ): Promise<{ paymentHash: string; paymentRequest: string; preimage?: string }> {
    const url = `${this.baseUrl}/api/v1/payments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Api-Key': this.invoiceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        out: false,
        amount: totalAmountSats,
        memo,
        expiry: ttlSeconds
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LNbits broker invoice creation failed [${res.status}]: ${errText}`);
    }

    const data: any = await res.json();
    return {
      paymentHash: data.payment_hash,
      paymentRequest: data.payment_request || data.bolt11
    };
  }

  public async verifyAgentPayment(paymentHash: string, preimage: string): Promise<boolean> {
    // 1. Cryptographic pre-check: SHA256(preimage) === paymentHash
    if (!verifyPreimage(preimage, paymentHash)) {
      return false;
    }

    // 2. Query LNbits payment status on treasury wallet
    try {
      const url = `${this.baseUrl}/api/v1/payments/${paymentHash}`;
      const res = await fetch(url, {
        headers: {
          'X-Api-Key': this.invoiceKey
        }
      });

      if (!res.ok) return false;
      const data: any = await res.json();
      return data.paid === true;
    } catch {
      return false;
    }
  }

  public async settleUpstreamInvoice(
    upstreamBolt11: string,
    amountSats: number
  ): Promise<{ success: boolean; preimage?: string; error?: string }> {
    if (!this.adminKey) {
      return {
        success: false,
        error: 'LNbits adminKey not configured on broker gateway. Cannot execute upstream settlement disbursement.'
      };
    }

    try {
      const url = `${this.baseUrl}/api/v1/payments`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.adminKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          out: true,
          bolt11: upstreamBolt11
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, error: `Upstream disbursement failed [${res.status}]: ${errText}` };
      }

      const data: any = await res.json();
      return {
        success: true,
        preimage: data.preimage || data.payment_preimage
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
