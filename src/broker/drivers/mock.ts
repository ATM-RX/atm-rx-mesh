import { BrokerSettlementDriver } from '../../types.js';
import { generateRandomHex, sha256, verifyPreimage } from '../../core/crypto.js';

/**
 * Sandbox Mock Broker Settlement Driver
 * Enables offline end-to-end verification of the clearinghouse protocol spread.
 */
export class MockBrokerDriver implements BrokerSettlementDriver {
  public name = 'mock';
  private brokerPreimages = new Map<string, string>(); // brokerHash -> preimage
  private upstreamPreimages = new Map<string, string>(); // upstreamHash -> preimage

  public async createBrokerInvoice(
    totalAmountSats: number,
    memo: string,
    ttlSeconds = 600
  ): Promise<{ paymentHash: string; paymentRequest: string; preimage?: string }> {
    const preimage = generateRandomHex(32);
    const paymentHash = sha256(Buffer.from(preimage, 'hex'));
    this.brokerPreimages.set(paymentHash, preimage);

    const paymentRequest = `lnbc${totalAmountSats}0n1pmock_broker_${paymentHash.slice(0, 16)}`;
    return {
      paymentHash,
      paymentRequest,
      preimage // Included in mock mode for instant automated verification
    };
  }

  public async verifyAgentPayment(paymentHash: string, preimage: string): Promise<boolean> {
    const known = this.brokerPreimages.get(paymentHash);
    if (!known) {
      return verifyPreimage(preimage, paymentHash);
    }
    return known === preimage && verifyPreimage(preimage, paymentHash);
  }

  public async settleUpstreamInvoice(
    upstreamBolt11: string,
    amountSats: number
  ): Promise<{ success: boolean; preimage?: string; error?: string }> {
    // Generate deterministic mock upstream settlement preimage
    const upstreamPreimage = generateRandomHex(32);
    return {
      success: true,
      preimage: upstreamPreimage
    };
  }
}
