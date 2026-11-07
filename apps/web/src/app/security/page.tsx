import type { Metadata } from 'next';
import '@/components/static-pages/static-pages.css';

/**
 * `/security` — security posture summary (docs/SECURITY.md). Copy-only:
 * states the baseline, the threat register and the disclosure path. Does
 * not publish working exploit details or internal architecture.
 */
export const metadata: Metadata = {
  title: 'Security',
  description:
    'SENTRAVYN security posture: the requirements the product is built to, ' +
    'the threats it models, and how to report vulnerabilities responsibly.',
};

export default function SecurityPage() {
  return (
    <section className="info-page" aria-labelledby="security-heading">
      <p className="info-page__eyebrow">Legal &amp; privacy</p>
      <h1 id="security-heading" className="info-title">
        Security
      </h1>
      <p className="info-sub">
        A summary of the security posture the SENTRAVYN product is built
        against, and how to report issues responsibly. This is a public summary
        of docs/SECURITY.md, not a disclosure of internal architecture or
        unpatched issues.
      </p>

      <div className="info-block">
        <h2>Baseline</h2>
        <p>
          SENTRAVYN follows the OWASP ASVS as its application-security reference
          and assesses the OWASP API Security Top 10 against the
          platform&rsquo;s deployment risk. In practice that means:
        </p>
        <ul>
          <li>Schema validation at every input boundary.</li>
          <li>Rate limits and abuse controls on every endpoint.</li>
          <li>
            Role-based access control with least privilege, and MFA for
            privileged accounts.
          </li>
          <li>
            Short-lived access tokens, rotating refresh tokens and secure
            session revocation.
          </li>
          <li>
            No secrets in source code, client bundles, logs or history; secrets
            live in managed storage.
          </li>
          <li>TLS for sensitive traffic.</li>
        </ul>
      </div>

      <div className="info-block">
        <h2>Threats the product is designed against</h2>
        <p>
          The project maintains a threat register covering, at minimum:
          fake-alert injection, provider or API compromise, admin account
          takeover, shelter-verification fraud, location stalking or disclosure,
          API scraping and denial of service, malicious feed payloads,
          dependency and CI compromise, notification spoofing, insider misuse,
          and data corruption or replay. Quarantine and human review are the
          default state for anything malformed or suspicious, so a compromised
          or hostile feed can never reach the public surfaces on its own.
        </p>
      </div>

      <div className="info-block">
        <h2>Reporting a vulnerability</h2>
        <p>
          Report security issues responsibly through the project&rsquo;s
          vulnerability disclosure process, as described in docs/SECURITY.md in
          the public repository. Please do not publish details of an unpatched
          issue publicly, and do not include other people&rsquo;s personal data
          in a report.
        </p>
      </div>
    </section>
  );
}
