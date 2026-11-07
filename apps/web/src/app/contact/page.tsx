import type { Metadata } from 'next';
import '@/components/static-pages/static-pages.css';

/**
 * `/contact` — honest contact page. No support inbox has been published
 * yet, so the page says so plainly and offers the honest fallback paths
 * (CLAUDE.md rule 15: no placeholder functionality disguised as
 * implemented). No form is shipped: a form would imply a backend that
 * does not exist.
 */
export const metadata: Metadata = {
  title: 'Contact',
  description:
    'How to reach the SENTRAVYN team. No support inbox is published yet; ' +
    'security reports and bug reports should use the repository issues.',
};

export default function ContactPage() {
  return (
    <section className="info-page" aria-labelledby="contact-heading">
      <p className="info-page__eyebrow">Contact</p>
      <h1 id="contact-heading" className="info-title">
        Contact
      </h1>
      <p className="info-sub">
        SENTRAVYN is a software project. There is no operator desk, no dispatch
        line and no phone support — and there never will be, because SENTRAVYN
        is not an operational emergency service.
      </p>

      <div className="info-notice" role="note">
        <p className="info-notice__title">Current state</p>
        <p>
          A web contact form and a public support email are not connected yet.
          Until they are, the routes below are the only honest ways to reach the
          team.
        </p>
      </div>

      <div className="info-block">
        <h2>For in-emergency situations</h2>
        <p>
          Do not use this page for emergencies. If you are in immediate danger,
          contact your local emergency services by the official number for your
          region (for example 911, 112 or your country&rsquo;s equivalent) and
          follow official local instructions.
        </p>
      </div>

      <div className="info-block">
        <h2>Report a bug or data problem</h2>
        <p>
          Bug reports, broken links, wrong data or missing coverage can be filed
          as an issue on the project repository. Please include where you saw
          the problem, what you expected, and the timestamp of the data if it
          concerns a specific alert or place.
        </p>
      </div>

      <div className="info-block">
        <h2>Security reports</h2>
        <p>
          Security issues should be reported responsibly through the
          project&rsquo;s vulnerability disclosure process, following
          docs/SECURITY.md in the repository. Reports that include credentials,
          personal data or location details are handled under the
          project&rsquo;s security policy.
        </p>
      </div>

      <div className="info-block">
        <h2>What we cannot help with</h2>
        <p>
          SENTRAVYN cannot confirm that a specific building is safe, certify a
          shelter, issue evacuation instructions, or act on your behalf in an
          emergency. Those decisions belong to official authorities and to you.
        </p>
      </div>
    </section>
  );
}
