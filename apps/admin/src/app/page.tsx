import Link from 'next/link';

/**
 * Admin console landing (DESIGN.md 6: operational clarity over marketing).
 *
 * Documents the role model and audit requirement, and links into the Phase 2
 * surfaces: review queue, provider registry, audit trail and sign-in.
 * No privileged capability is enabled on this page.
 */

const roles: Array<{ name: string; scope: string }> = [
  {
    name: 'PUBLIC',
    scope: 'Reads published, source-backed content. No privileged actions.',
  },
  {
    name: 'REVIEWER',
    scope: 'Reviews quarantined alerts and user submissions. Does not publish.',
  },
  {
    name: 'OPERATOR',
    scope:
      'Publishes reviewed alerts; manages provider configuration. MFA required.',
  },
  {
    name: 'ADMIN',
    scope:
      'Approves shelter verification and guide publication. Full audit. MFA required.',
  },
];

export default function AdminHome() {
  return (
    <section>
      <p className="admin-badged">Restricted</p>
      <h1>Administration</h1>
      <p className="sub">
        Role-based source configuration, alert review, place verification, guide
        approval and audit history. Access requires an authorised session;
        privileged roles require multi-factor authentication.
      </p>

      <nav className="workspaces" aria-label="Workspaces">
        <Link className="workspace" href="/review">
          <div>
            <strong>Review queue</strong>
            <span>
              Quarantined alerts and unverified shelter profiles. REVIEWER+.
            </span>
          </div>
        </Link>
        <Link className="workspace" href="/providers">
          <div>
            <strong>Data providers</strong>
            <span>
              Source registry: documentation, license, attribution and
              enablement. ADMIN controls.
            </span>
          </div>
        </Link>
        <Link className="workspace" href="/audit">
          <div>
            <strong>Audit trail</strong>
            <span>Immutable record of privileged changes. ADMIN.</span>
          </div>
        </Link>
        <Link className="workspace" href="/security">
          <div>
            <strong>Security</strong>
            <span>
              Multi-factor authentication and active session management.
            </span>
          </div>
        </Link>
        <Link className="workspace" href="/login">
          <div>
            <strong>Sign in</strong>
            <span>Register or authenticate a session.</span>
          </div>
        </Link>
      </nav>

      <h2>Role model</h2>
      <ul className="roles">
        {roles.map((r) => (
          <li key={r.name}>
            <div className="r-name">{r.name}</div>
            <div>{r.scope}</div>
          </li>
        ))}
      </ul>

      <p className="audit-note">
        Every privileged change to alerts, sources, guides, shelters,
        verification state and user access is recorded in the audit log
        (SECURITY.md 6). The review queue organises human judgement and never
        asserts that a place is open, safe or operational.
      </p>
    </section>
  );
}
