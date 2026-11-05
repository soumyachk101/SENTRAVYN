import type { Metadata } from 'next';
import '@/components/static-pages/static-pages.css';

/**
 * `/privacy` — the location and data principles the project commits to
 * (docs/SECURITY.md 5, CLAUDE.md "Security"). Copy-only: this page states
 * the minimisation and consent principles the product is built around. It
 * is not a final legal privacy policy — that is a documented, not-yet-done
 * step, and this page says so rather than impersonate one.
 */
export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'SENTRAVYN privacy principles: precise location is never collected by ' +
    'default, location sharing is consent-based and revocable, and precise ' +
    'location is excluded from analytics.',
};

export default function PrivacyPage() {
  return (
    <section className="info-page" aria-labelledby="privacy-heading">
      <p className="info-page__eyebrow">Legal &amp; privacy</p>
      <h1 id="privacy-heading" className="info-title">
        Privacy principles
      </h1>
      <p className="info-sub">
        The privacy commitments SENTRAVYN is engineered around. A final,
        signed-off privacy policy document will accompany a production launch;
        until then this page states the principles the product currently
        implements, honestly and without over-claiming.
      </p>

      <div className="info-notice" role="note">
        <p className="info-notice__title">Status</p>
        <p>
          This page describes implemented product behaviour and the security
          requirements in docs/SECURITY.md. It is not a complete legal privacy
          notice, and no privacy impact assessment has been published yet — that
          is a documented pre-launch step, not a completed one.
        </p>
      </div>

      <div className="info-block">
        <h2>Location</h2>
        <ul>
          <li>
            Precise location is highly sensitive, and SENTRAVYN does not collect
            it by default. The web map surface has no automatic geolocation: a
            search centre is always chosen manually.
          </li>
          <li>
            Location sharing between family accounts, where it exists, is
            explicit: it starts only with informed consent, names the recipient
            and purpose, has a bounded duration, and can be revoked immediately.
            There is no covert or continuous tracking.
          </li>
          <li>
            Precise location is excluded from analytics and ordinary logs.
          </li>
        </ul>
      </div>

      <div className="info-block">
        <h2>Accounts and personal data</h2>
        <ul>
          <li>
            Accounts store only what the product needs to work: identity, role
            and the user&rsquo;s own preparedness data (contacts, plans).
          </li>
          <li>
            Sessions use short-lived access tokens with rotating refresh tokens;
            privileged administration requires MFA.
          </li>
          <li>
            Users are offered deletion and privacy controls, and there is a
            documented path to get them in place.
          </li>
        </ul>
      </div>

      <div className="info-block">
        <h2>User submissions</h2>
        <p>
          Submissions (for example, evidence about a place) are treated as
          unverified until reviewed and are stored with their provenance. They
          never change official alert or shelter state on their own.
        </p>
      </div>

      <div className="info-block">
        <h2>What we do not do</h2>
        <ul>
          <li>Do not sell location data or personal data.</li>
          <li>
            Do not share exact user location with analytics or third parties
            without explicit consent and a documented need.
          </li>
          <li>Do not keep precise location in logs or caches.</li>
        </ul>
      </div>
    </section>
  );
}
