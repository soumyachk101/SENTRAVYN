import type { Metadata } from 'next';
import { AuthPanel } from '@/components/account/AuthPanel';
import { CoverageDisclosure } from '@/components/coverage/CoverageDisclosure';
import { safety } from '@/content/safety';

export const metadata: Metadata = {
  description:
    'Sign in to SENTRAVYN: manage your account and your preparedness profile.',
};

/**
 * Landing page (DESIGN.md 6). Original hero, immediate access to preparedness
 * resources, transparent limitations. No fake statistics, no invented
 * partner logos, no trust claims (DESIGN.md 6; anti-slop rules).
 *
 * This is the Phase 1 foundation shell: content here is preparedness
 * material, not live emergency data. No external data is fetched or
 * displayed on this page.
 */
export default function Home() {
  return (
    <section className="hero">
      <div className="hero__eyebrow">
        Global Emergency Intelligence &amp; Public Safety
      </div>
      <h1 className="hero__title">
        Know Where to Go.
        <br />
        Know What to Do.
        <br />
        Stay Prepared.
      </h1>
      <p className="hero__lede">
        SENTRAVYN helps you access authoritative emergency alerts, understand
        reviewed protective guidance, find nearby emergency services and prepare
        your household before an emergency.
      </p>

      <ul className="hero__modules" aria-label="Core modules">
        {safety.modules.map((m) => (
          <li key={m.id} className="module-card">
            <div className="module-card__index">{m.index}</div>
            <div>
              <h2 className="module-card__title">{m.title}</h2>
              <p className="module-card__body">{m.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <section aria-labelledby="account-heading" className="hero__account">
        <h2 id="account-heading" className="hero__account-heading">
          Account
        </h2>
        <AuthPanel />
      </section>

      <div className="hero__limitations">
        <h2>What SENTRAVYN is not</h2>
        <ul>
          {safety.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="hero__disclaimer">{safety.disclaimer}</p>

        {/* Phase 10 section 1: the registry-derived live coverage
            disclosure, compact form. Stated from the enabled provider
            registry, never a hard-coded claim; the no-coverage state is
            shown plainly when nothing is enabled. */}
        <CoverageDisclosure compact />
      </div>
    </section>
  );
}
