# ⚡ atm-rx-mesh

[![npm version](https://img.shields.io/npm/v/atm-rx-mesh.svg?color=gold&style=flat-square)](https://www.npmjs.com/package/atm-rx-mesh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Lightning Network](https://img.shields.io/badge/Protocol-L402%20%2F%20LSAT-orange.svg?style=flat-square)](https://lightning.engineering)
[![Edge Runtime](https://img.shields.io/badge/Platform-Cloudflare%20Workers-f38020.svg?style=flat-square)](https://workers.cloudflare.com)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript%205.7-blue.svg?style=flat-square)](https://www.typescriptlang.org)

> **Sovereign AI Agent Tool Gateway & Clearinghouse with Automated Protocol Take-Rate (L402 / Bitcoin Lightning Network)**  
> *Engineered by Brandon Binion (ATM-RX)*

`atm-rx-mesh` is a high-throughput, edge-native clearinghouse and reverse proxy designed for autonomous AI agent tool economies. It intercepts paid tool calls (`HTTP 402 Payment Required`), transparently wraps upstream Bolt11 invoices with an automated protocol fee spread (take-rate), bills the consuming AI agent, settles the upstream tool provider, and deposits the arbitrage spread directly into your treasury wallet.

---

## 🏛️ System Architecture

```
                                      ┌───────────────────────────────────────┐
                                      │         ATM-RX MESH GATEWAY           │
                                      │   (Cloudflare Worker / Node Server)   │
                                      └──────────────────┬────────────────────┘
                                                         │
   ┌───────────────────────┐                             │                             ┌────────────────────────┐
   │    CONSUMING AGENT    │                             │                             │  UPSTREAM TOOL / API   │
   │ (LangChain, AutoGen)  │                             │                             │ (L402 Protected Tool)  │
   └──────────┬────────────┘                             │                             └───────────┬────────────┘
              │                                          │                                         │
              │ 1. GET /v1/proxy?url={target_tool}       │                                         │
              ├─────────────────────────────────────────>│ 2. Probes Upstream API                  │
              │                                          ├────────────────────────────────────────>│
              │                                          │                                         │
              │                                          │ 3. 402 Payment Required (Invoice: 100s) │
              │                                          │<────────────────────────────────────────┤
              │                                          │                                         │
              │                                    [SPREAD ENGINE]                                 │
              │                                    Levies +5% Take-Rate                            │
              │                                    + 1 sat Toll Floor                              │
              │                                    Rex Profit = 5 sats                             │
              │                                    Total Billed = 105 sats                         │
              │                                          │                                         │
              │ 4. 402 Payment Required (Invoice: 105s)  │                                         │
              │<─────────────────────────────────────────┤                                         │
              │                                          │                                         │
              │ 5. Settles 105 sats to Mesh Treasury     │                                         │
              ├─────────────────────────────────────────>│                                         │
              │    (Authorization: L402 <token>)         │                                         │
              │                                    [ATOMIC COMMIT]                                 │
              │                                    Replay Defense Check                            │
              │                                          │                                         │
              │                                          │ 6. Settles 100 sats to Upstream Provider│
              │                                          ├────────────────────────────────────────>│
              │                                          │                                         │
              │                                          │ 7. 200 OK + Tool Execution Payload      │
              │                                          │<────────────────────────────────────────┤
              │                                          │                                         │
              │ 8. 200 OK + Upstream Result              │  (Rex captures +5 sats net protocol fee)│
              │<─────────────────────────────────────────┤                                         │
              │                                          │                                         │
```

---

## ✨ Core Capabilities

- **Automated Protocol Spread (Take-Rate):** Configurable take-rate percentage (default 5%) and minimum toll floor (default 1 sat). Automatically bills the agent a surcharge on every tool invocation.
- **Single-Flight Atomic Replay Defense:** In-memory and persistent cryptographic preimage verification prevents double-spending or token reuse.
- **Dynamic L402 Macaroon Minting:** Generates cryptographically signed macaroons with target-URL caveats, method restrictions, and expiration timestamps.
- **Dual Settlement Engines:**
  - `mock`: Instant zero-latency offline sandbox for unit tests and local agent simulations.
  - `lnbits`: Production Bitcoin Lightning Network settlement driver with automated payout orchestration via LNbits REST API.
- **Polyglot Agent SDK (`MeshAgentClient`):** High-level client wrapper that drops into Python, Node.js, LangChain, Claude MCP, and AutoGen agent workflows.
- **Universal Edge Deployment:** Compiles to zero-dependency Cloudflare Workers isolates using `@hono/node-server` and `nodejs_compat`.

---

## 🚀 Quick Start

### 1. Installation

```bash
# Global CLI Installation
npm install -g atm-rx-mesh

# Or install locally in your project
pnpm add atm-rx-mesh
```

### 2. Run the Gateway Locally

```bash
# Start Gateway on port 4021 with default 5% take-rate
mesh serve --port 4021 --take-rate 0.05 --min-toll 1

# Production mode with LNbits Treasury Wallet
SETTLEMENT_DRIVER=lnbits \
LNBITS_API_URL=https://demo.lnbits.com \
LNBITS_INVOICE_KEY=f76eb7089bc94495b82bd9c9f7dcac4e \
LNBITS_ADMIN_KEY=your_admin_key \
mesh serve
```

### 3. Calculate Protocol Margins

```bash
mesh calc-spread 100 --take-rate 0.05 --min-toll 1
```
Output:
```
───────────────── SPREAD BREAKDOWN ─────────────────
Upstream Service Price:   100 sats
ATM-RX Take-Rate Fee:     5 sats (5.0%)
Total Billed to Agent:    105 sats
────────────────────────────────────────────────────
```

### 4. Query Gateway Telemetry

```bash
mesh stats --gateway http://localhost:4021
```
Output:
```
╔══════════════════════════════════════════════════════════════╗
║           ATM-RX MESH: CLEARINGHOUSE TELEMETRY               ║
╚══════════════════════════════════════════════════════════════╝
⚡ Operator:            ATM-RX (Brandon Binion)
⚡ Clearinghouse:       ATM-RX Mesh Treasury
⚡ Protocol Take-Rate:  5.0% (min 1 sat)
⚡ Total Requests:      1,420
⚡ Gross Volume:        148,500 sats
⚡ Protocol Fees Rex:   7,425 sats
⚡ Active Escrows:      0
```

---

## 🤖 AI Agent Client SDK

Integrate `MeshAgentClient` into any autonomous agent toolchain:

```typescript
import { MeshAgentClient } from 'atm-rx-mesh';

const client = new MeshAgentClient({
  meshGatewayUrl: 'https://atm-rx-mesh.workers.dev',
  maxFeeSats: 100, // Agent security ceiling
  verbose: true
});

// Call any paid L402 tool API anywhere on the web
const response = await client.fetch('https://api.upstream-service.com/v1/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'quantum state teleportation' })
});

console.log('Status:', response.status);
console.log('Protocol Fee Paid:', response.spread?.protocolFeeSats, 'sats');
console.log('Tool Data:', response.data);
```

---

## 🛡️ Offensive Security & Red Team Defenses

`atm-rx-mesh` was audited and engineered against MITRE ATLAS and OWASP Top 10 API vulnerabilities:

1. **Cryptographic Timing Attack Prevention:** Macaroon HMAC-SHA256 signatures are evaluated using constant-time `crypto.timingSafeEqual`.
2. **Replay & Double-Spend Defense:** The `BrokerLedger` enforces an atomic state transition (`PENDING_AGENT_PAYMENT` -> `SETTLED`). Once consumed, a payment hash cannot be replayed.
3. **Agent Spend Ceiling Guard:** AI agents define a hard `maxFeeSats` limit. If an upstream service demands exorbitant rates or malicious price spikes, execution is aborted *before* invoice settlement.
4. **Header Taint Filtering:** Hop-by-hop headers (`Host`, `Connection`, `Authorization`) are sanitized before proxying upstream to eliminate HTTP request smuggling.

---

## 🌐 Edge Deployment (Cloudflare Workers)

Deploy your own private sovereign clearinghouse in seconds:

```bash
# Clone and build
git clone https://github.com/ATM-RX/atm-rx-mesh.git
cd atm-rx-mesh
pnpm install
pnpm run build

# Deploy to Cloudflare Workers
npx wrangler deploy
```

---

## 📜 License

MIT © 2026 Brandon Binion (ATM-RX).
