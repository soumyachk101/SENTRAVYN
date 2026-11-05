import type { Metadata } from 'next';
import '@/components/static-pages/static-pages.css';

/**
 * `/terms` — honest, minimal terms page. Copies the product's core
 * positioning (README "Important", SAFETY-POLICY.md 1, 6) as plain usage
 * terms. It is deliberately short and says explicitly what it is not: a
 * final legal terms document for a production launch.
 */
export const metadata: Metadata = {
  title: 'Terms of use',
  description:
    'Plain terms for using SENTRAVYN: it is an information and preparedness ' +
    'platform, not an operational emergency service; follow official ' +
    'instructions in an emergency.',
};

export default function TermsPage() {
  return (
    <section className="info-page" aria-labelledby="terms-heading">
      <p className="info-page__eyebrow">Legal &amp; privacy</p>
      <h1 id="terms-heading" className="info-title">
        Terms of use
      </h1>
      <p className="info-sub">
        The plain-terms summary of what SENTRAVYN is, what it is not, and what
        you should rely on instead. A final legal terms document accompanies a
        production launch; until then, these are the commitments the product
        operates under today.
      </p>

      <div className="info-notice" role="note">
        <p className="info-notice__title">Status</p>
        <p>
          This is a working summary of the product&rsquo;s safety and content
          policy, not a final legal agreement. Nothing on this page should be
          read as a substitute for official emergency instructions.
        </p>
      </div>

      <div className="info-block">
        <h2>What SENTRAVYN is</h2>
        <p>
          An information and preparedness platform: authoritative emergency
          alerts, reviewed protective guidance, place discovery and household
          preparedness tools. Every displayed item carries its information
          class, source provenance, timestamps and an explicit freshness label.
        </p>
      </div>

      <div className="info-block">
        <h2>What SENTRAVYN is not</h2>
        <ul>
          <li>
            Not an operational emergency service. It does not dispatch, triage
            or respond to incidents.
          </li>
          <li>
            Not a substitute for local emergency services, official warnings,
            professional medical care or government evacuation instructions.
          </li>
          <li>
            Not a safety certification: it does not certify buildings or
            shelters as safe, and a map point is not proof a place is open, safe
            or operational.
          </li>
          <li>Not a predictor: it does not predict events or outcomes.</li>
        </ul>
      </div>

      <div className="info-block">
        <h2>In an emergency</h2>
        <p>
          Follow official instructions from your local authorities and contact
          your local emergency services for immediate danger. If anything shown
          on SENTRAVYN ever conflicts with an official instruction, the official
          instruction wins.
        </p>
      </div>

      <div className="info-block">
        <h2>Data you rely on</h2>
        <p>
          Alert and place data comes from sources under their own terms, and
          from SENTRAVYN&rsquo;s review process. Where data is stale, expired or
          unverified, it is labelled as such — use it with that label in mind,
          and confirm with official sources before acting.
        </p>
      </div>
    </section>
  );
}
