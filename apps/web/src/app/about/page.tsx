import type { Metadata } from 'next';
import '@/components/static-pages/static-pages.css';

/**
 * `/about` — who SENTRAVYN is (PRODUCT-SPEC.md 1; README "Important").
 * Copy-only: no data fetch, no live claims. Uses the exact README
 * disclaimer tone: an information-and-preparedness platform, not an
 * operational emergency service.
 */
export const metadata: Metadata = {
  title: 'About SENTRAVYN',
  description:
    'SENTRAVYN is an information and preparedness platform: authoritative ' +
    'emergency alerts, reviewed protective guidance, place discovery and ' +
    'household preparedness. It is not an operational emergency service.',
};

export default function AboutPage() {
  return (
    <section className="info-page" aria-labelledby="about-heading">
      <p className="info-page__eyebrow">About</p>
      <h1 id="about-heading" className="info-title">
        About SENTRAVYN
      </h1>
      <p className="info-sub">
        SENTRAVYN is a global information and preparedness platform. It helps
        people access authoritative emergency information, understand reviewed
        guidance and prepare their households before an emergency.
      </p>

      <div className="info-block">
        <h2>What we do</h2>
        <p>
          SENTRAVYN collects, reviews and presents public-safety information
          from authoritative sources. Every item we display is distinguished by
          its information class — official source content, a SENTRAVYN-reviewed
          summary, third-party data, a user submission, a derived calculation,
          or unverified or stale information — and carries its source, its
          timestamps and an explicit freshness label.
        </p>
        <ul>
          <li>
            <strong>Emergency alerts.</strong> Source-backed alerts with issuer,
            times, severity, urgency and certainty, shown only when they have
            passed review and validation. Stale or expired alerts are labelled
            as such, never hidden as live.
          </li>
          <li>
            <strong>Reviewed safety guides.</strong> Hazard-specific protective
            guidance, always a summary of authoritative sources with references,
            review dates and versions — never an official order in our own name.
          </li>
          <li>
            <strong>Place discovery.</strong> Hospitals, services and shelters,
            each with its verification label. A map listing is never presented
            as proof that a place is open, safe or operational, and no shelter
            is shown as verified without the required evidence and an authorised
            approval.
          </li>
          <li>
            <strong>Preparedness.</strong> Household checklists, contacts and
            meeting points, so a plan exists before an emergency makes one
            necessary.
          </li>
        </ul>
      </div>

      <div className="info-block">
        <h2>What SENTRAVYN is not</h2>
        <p>
          SENTRAVYN is an information and preparedness platform. It is not a
          substitute for local emergency services, official warnings,
          professional medical care or government evacuation instructions.
        </p>
        <ul>
          <li>
            It is not an operational emergency service: it does not dispatch,
            triage or respond to incidents.
          </li>
          <li>
            It does not issue evacuation orders, certify buildings as safe, or
            predict events without validated authoritative models.
          </li>
          <li>
            It does not replace official local emergency instructions, which
            always take precedence over anything shown here.
          </li>
          <li>
            User submissions are treated as unverified until they pass review;
            they never change official alert or shelter status on their own.
          </li>
        </ul>
      </div>

      <div className="info-block">
        <h2>Trust rules</h2>
        <p>
          SENTRAVYN follows a written safety, content and verification policy
          (docs/SAFETY-POLICY.md in the public repository): every displayed item
          is class-labelled, source provenance and timestamps are preserved, and
          anything that is unknown, stale, incomplete or unverified is said to
          be so, clearly and without ambiguity.
        </p>
        <p>
          Official local emergency instructions always take precedence over
          general SENTRAVYN guidance.
        </p>
      </div>
    </section>
  );
}
