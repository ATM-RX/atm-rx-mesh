/**
 * ⚡ ATM-RX MESH - LINEAR & SLACK TOOL CONNECTOR (BRA-2)
 *
 * Implements bidirectional integration between Linear issues, Slack alerts,
 * and the Sovereign AI Agent Clearinghouse.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | "Project" | "Cycle";
  data: {
    id: string;
    identifier?: string; // e.g. "BRA-2"
    title?: string;
    description?: string;
    state?: {
      name: string;
      type: string;
    };
    priority?: number;
    team?: {
      id: string;
      key: string;
      name: string;
    };
    assignee?: {
      id: string;
      name: string;
      email?: string;
    };
  };
  url?: string;
  createdAt: string;
}

export class LinearIntegrationService {
  private webhookSecret?: string;
  private slackWebhookUrl?: string;

  constructor(options?: { webhookSecret?: string; slackWebhookUrl?: string }) {
    this.webhookSecret = options?.webhookSecret || process.env.LINEAR_WEBHOOK_SECRET;
    this.slackWebhookUrl = options?.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL;
  }

  /**
   * Cryptographically verifies the incoming Linear Webhook HMAC-SHA256 signature
   */
  public verifyWebhookSignature(rawBody: string, signatureHeader?: string): boolean {
    if (!this.webhookSecret || !signatureHeader) {
      return false;
    }

    try {
      const hmac = createHmac("sha256", this.webhookSecret);
      const computedSignature = hmac.update(rawBody).digest("hex");
      
      const sigBuffer = Buffer.from(signatureHeader, "hex");
      const computedBuffer = Buffer.from(computedSignature, "hex");

      if (sigBuffer.length !== computedBuffer.length) {
        return false;
      }

      return timingSafeEqual(sigBuffer, computedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Processes incoming Linear webhook event and dispatches real-time alerts
   */
  public async handleWebhook(payload: LinearWebhookPayload): Promise<{ handled: boolean; sirenDispatched: boolean }> {
    let sirenDispatched = false;

    if (payload.type === "Issue") {
      const issueKey = payload.data.identifier || "UNKNOWN";
      const issueTitle = payload.data.title || "Untitled Issue";
      const action = payload.action;
      const stateName = payload.data.state?.name || "Triage";

      // Dispatch high-priority alert to Slack siren if configured
      if (this.slackWebhookUrl) {
        sirenDispatched = await this.dispatchSlackNotification({
          text: `🎯 *[Linear ${issueKey}]* Issue ${action.toUpperCase()}: *${issueTitle}* (State: \`${stateName}\`)\n🔗 ${payload.url || "https://linear.app"}`,
        });
      }
    }

    return {
      handled: true,
      sirenDispatched,
    };
  }

  /**
   * Sends formatted notification to Slack Webhook
   */
  private async dispatchSlackNotification(payload: { text: string }): Promise<boolean> {
    if (!this.slackWebhookUrl) return false;

    try {
      const res = await fetch(this.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
