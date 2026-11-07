# SENTRAVYN Security & Privacy Requirements

## 1. Security baseline

Use OWASP ASVS as an application security verification reference and assess the OWASP API Security Top 10. Define the target assurance level with a security reviewer based on deployment risk.

## 2. Identity and access

- Use a maintained OIDC-compatible identity provider or a carefully reviewed authentication implementation.
- MFA required for privileged administrators.
- Role-based access control and least privilege.
- Short-lived access tokens and secure refresh/session rotation.
- Secure cookie settings for browser sessions.
- Account recovery resistant to enumeration and abuse.
- Revoke sessions after credential compromise.
- Separate public, reviewer, operator and administrator capabilities.

## 3. API security

- DTO/schema validation at every boundary.
- Rate limits and abuse controls.
- Strict CORS allowlist.
- CSRF protections where cookie authentication applies.
- Output encoding and XSS protection.
- SQL injection prevention.
- SSRF protection for URL-fetching integrations.
- Request size and upload limits.
- Safe file type validation and malware scanning where appropriate.
- Idempotency for sensitive operations.
- Object-level authorisation checks.
- Avoid leaking internal errors or stack traces.

## 4. Secrets and infrastructure

- No secrets in source code, client bundles, logs or repository history.
- Use managed secret storage.
- Least-privilege IAM and service identities.
- Separate environments and credentials.
- Rotate credentials.
- Pin and review dependencies.
- Scan images and dependencies.
- Protect CI/CD secrets and deployment permissions.
- Use TLS for all external and internal sensitive traffic where feasible.

## 5. Location and personal data

Precise location is highly sensitive.

- Ask permission at the moment of need.
- Offer manual location selection.
- Do not collect background location by default.
- Share location only with explicit, informed consent.
- Define recipient, purpose, duration and revocation.
- Minimise precision and retention.
- Encrypt sensitive data.
- Exclude precise location from analytics and ordinary logs.
- Do not sell location data.
- Provide clear deletion and privacy controls.
- Conduct a privacy impact assessment before launch.

## 6. Audit

Record privileged changes to alerts, sources, guides, shelters, verification state and user access. Logs must be tamper-resistant enough for the operational threat model and must avoid unnecessary personal data.

## 7. Resilience

- Backups and tested restoration.
- Database point-in-time recovery where supported.
- Queue retry and dead-letter handling.
- Circuit breakers and timeouts.
- Provider outage handling.
- WAF and DDoS protection appropriate to risk.
- Incident response plan.
- Vulnerability disclosure process.
- Security monitoring and alerting.

## 8. Threat modelling

At minimum assess:
- Fake alert injection.
- Provider/API compromise.
- Admin account takeover.
- Shelter verification fraud.
- Location stalking or disclosure.
- API scraping and denial of service.
- Malicious feed payloads.
- Dependency and CI compromise.
- Notification spoofing.
- Insider misuse.
- Data corruption and replay.

Maintain a threat register with owner, likelihood, impact, mitigation and residual risk.
