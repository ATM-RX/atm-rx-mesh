import { LinearIntegrationService, LinearWebhookPayload } from '../src/integrations/linear.js';
import { createHmac } from 'node:crypto';

export async function runLinearTests(): Promise<boolean> {
  console.log('--- Testing Linear & Slack Integration Service (BRA-2) ---');
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

  const testSecret = 'linear_webhook_secret_super_test_key_12345';
  const service = new LinearIntegrationService({
    webhookSecret: testSecret,
  });

  try {
    // 1. Valid Signature Verification
    const payloadBody = JSON.stringify({
      action: 'create',
      type: 'Issue',
      data: {
        id: 'issue_bra_2_test',
        identifier: 'BRA-2',
        title: 'Connect your tools',
        state: { name: 'In Progress', type: 'started' },
      },
      createdAt: new Date().toISOString(),
    });

    const validSignature = createHmac('sha256', testSecret).update(payloadBody).digest('hex');
    const isValid = service.verifyWebhookSignature(payloadBody, validSignature);
    assert(isValid === true, 'Linear HMAC-SHA256 signature validated successfully');

    // 2. Tampered Payload Rejection
    const tamperedPayload = payloadBody + ' ';
    const isTamperedValid = service.verifyWebhookSignature(tamperedPayload, validSignature);
    assert(isTamperedValid === false, 'Tampered payload rejected by HMAC verification');

    // 3. Forged Signature Rejection
    const forgedSignature = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const isForgedValid = service.verifyWebhookSignature(payloadBody, forgedSignature);
    assert(isForgedValid === false, 'Forged signature rejected');

    // 4. Missing / Malformed Signature Rejection
    const isMissingValid = service.verifyWebhookSignature(payloadBody, undefined);
    assert(isMissingValid === false, 'Missing signature rejected');

    // 5. Webhook Event Handling (Issue event)
    const testPayload: LinearWebhookPayload = JSON.parse(payloadBody);
    const result = await service.handleWebhook(testPayload);
    assert(result.handled === true, 'Linear Issue payload handled correctly');
    assert(result.sirenDispatched === false, 'Slack notification gracefully skipped when webhook URL not configured');

  } catch (err: any) {
    console.error(`Linear integration test error: ${err.message}`);
    failed++;
  }

  console.log(`Linear Integration Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
