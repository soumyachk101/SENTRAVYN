import type { Metadata } from 'next';
import '@/components/static-pages/static-pages.css';

/**
 * `/verification` — copy-only explanation of the verification model
 * (SAFETY-POLICY.md 3, 8; PRODUCT-SPEC.md 6; ADR-018). No data fetch:
 * the page explains the labels you will see on the map surface and the
 * evidence rules behind a "verified" claim.
 */
export const metadata: Metadata = {
  title: 'Place verification',
  description:
    'How SENTRAVYN labels places: a map point is not a verified shelter. ' +
    'The six display labels, the required shelter evidence, and the ' +
    'stale/expired rules, explained.',
};

export default function VerificationPage() {
  return (
    <section className="info-page" aria-labelledby="verification-heading">
      <p className="info-page__eyebrow">Trust &amp; sources</p>
      <h1 id="verification-heading" className="info-title">
        How places are verified
      </h1>
      <p className="info-sub">
        A place appearing on a map is not proof that it is open, safe,
        operational or suitable as a shelter. SENTRAVYN makes that distinction
        explicit on every place it shows, and a shelter is only displayed as
        verified when the required evidence and an authorised approval are both
        on record.
      </p>

      <div className="info-block">
        <h2>The display labels</h2>
        <p>
          Every place on the map surface carries a text label, computed by the
          API at read time — colour is only a supporting signal, never the only
          one. The full set of labels:
        </p>
        <table className="info-label-table">
          <caption>
            The verification labels you will see on a place. A stored VERIFIED
            shelter can be downgraded at read time when its evidence has lapsed
            — it is never shown as verified after its expiry.
          </caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">What it means</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="info-label-value">UNVERIFIED</td>
              <td>
                No verified evidence on record for this place. It may be a
                listing, a community edit or an import — none of which
                establishes that the place is open, safe or suitable for any
                purpose.
              </td>
            </tr>
            <tr>
              <td className="info-label-value">REVIEWED</td>
              <td>
                The place has been reviewed, but the evidence required for a
                VERIFIED label (a shelter profile with documented inspection and
                a responsible authority) has not yet been completed.
              </td>
            </tr>
            <tr>
              <td className="info-label-value">VERIFIED</td>
              <td>
                A shelter (or other place that makes a shelter claim) with the
                required evidence on record, currently inside its revalidation
                window. Verification is a time-bound claim: it expires, and when
                it does the label changes.
              </td>
            </tr>
            <tr>
              <td className="info-label-value">STALE</td>
              <td>
                The place&rsquo;s information is older than the revalidation
                window allows. It may well still be correct, but SENTRAVYN will
                not display it as current.
              </td>
            </tr>
            <tr>
              <td className="info-label-value">EXPIRED</td>
              <td>
                An explicit expiry date on the shelter&rsquo;s verification has
                passed. The place must not be treated as a verified shelter
                until re-verified.
              </td>
            </tr>
            <tr>
              <td className="info-label-value">INCOMPLETE</td>
              <td>
                A shelter claim without the evidence required to confirm it (for
                example no inspection date on record, so the revalidation window
                cannot be checked). The claim is shown, but it is not treated as
                established.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="info-block">
        <h2>What &ldquo;verified shelter&rdquo; requires</h2>
        <p>
          A shelter may only be displayed as verified when documented evidence
          exists for every item below, and an authorised approval has been
          recorded against it. Missing any item means the shelter is not
          verified, full stop:
        </p>
        <ul>
          <li>The responsible verifying authority, named.</li>
          <li>
            The shelter&rsquo;s classification and which hazards it is intended
            for.
          </li>
          <li>
            A structural or facility assessment, where relevant to the hazard.
          </li>
          <li>Accessibility and available facilities.</li>
          <li>Capacity or occupancy evidence, where it is published.</li>
          <li>The date of the inspection or verification.</li>
          <li>
            The expiry or revalidation policy that governs how long the claim is
            valid.
          </li>
        </ul>
        <p>
          A hospital&rsquo;s location, its operational status, whether its
          emergency department is available and what its capacity is, are
          separate claims, each requiring its own evidence — verified on its
          own, not inferred from the fact that a hospital is on a map.
        </p>
      </div>

      <div className="info-block">
        <h2>Stale and expired information</h2>
        <p>
          Stale data is never silently shown as current. If a place&rsquo;s
          evidence has lapsed, the label changes to STALE or EXPIRED at read
          time and the reason is shown alongside it, so a lapsed shelter can
          never appear as a live, verified one. Freshness is computed by the API
          against each provider&rsquo;s policy; the UI only displays the label
          it is given.
        </p>
      </div>

      <div className="info-block">
        <h2>User submissions</h2>
        <p>
          Anyone can add evidence about a place, but a submission is treated as
          unverified until it has been reviewed. It is stored and logged, and it
          never changes a place&rsquo;s verification state, operational status
          or official alert status on its own.
        </p>
      </div>

      <div className="info-block">
        <h2>The bottom line</h2>
        <p>
          Official local emergency instructions and official shelter or
          evacuation announcements always take precedence over anything shown
          here. If a label on this site ever conflicts with an official
          instruction, follow the official instruction and report the conflict.
        </p>
      </div>
    </section>
  );
}
