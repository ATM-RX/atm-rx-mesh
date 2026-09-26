## ⚡ Description
<!-- High-level summary of the changes and integrations connected -->

Fixes BRA-2

### 🔗 Linear Issue Reference
- Linear Issue: [BRA-2](https://linear.app/brandonbinion/issue/BRA-2/connect-your-tools)
- Team: Brandon binion (`BRA`)

### 🛠️ Key Changes
- **Linear Webhook Receiver**: Integrated `LinearIntegrationService` with cryptographic HMAC-SHA256 signature verification.
- **Slack Incident Siren**: Added automated event dispatching for Linear issue status transitions and cycles.
- **CI/CD Automation**: Added GitHub Actions workflow (`linear-sync.yml`) enforcing issue key tracking and running full test suite on push/PR.
- **Unit & Integration Tests**: Expanded test runner to validate Linear HMAC authenticity and webhook parsing.

### 🛡️ Security & Zero-Trust Checklist
- [x] No plaintext credentials or API keys committed (`.env` guarded with 0600 permissions).
- [x] Timing-safe byte comparison (`crypto.timingSafeEqual`) used for HMAC signature validation.
- [x] All automated tests passing (`npm test`).
- [x] Production build passes (`npm run build`).
