/**
 * Admin console shell (DESIGN.md 6: operational clarity over marketing).
 *
 * Phase 1 foundation only: it documents the role model and the audit
 * requirement. The actual RBAC enforcement, audit-event capture, source
 * configuration and review workflows arrive in Phase 2
 * (docs/ROADMAP.md). No privileged capability is enabled here.
 */
const roles: Array<{ name: string; scope: string }> = [
  {
    name: "PUBLIC",
    scope: "Reads published, source-backed content. No privileged actions.",
  },
  {
    name: "REVIEWER",
    scope: "Reviews quarantined alerts and user submissions. Does not publish.",
  },
  {
    name: "OPERATOR",
    scope: "Publishes reviewed alerts; manages provider configuration. MFA required.",
  },
  {
    name: "ADMIN",
    scope: "Approves shelter verification and guide publication. Full audit. MFA required.",
  },
];

export default function AdminHome() {
  return (
    <section>
      <p className="admin-badged">Restricted</p>
      <h1>Administration</h1>
      <p className="sub">
        Role-based source configuration, alert review, place verification,
        guide approval and audit history. Access requires an authorised
        session; privileged roles require multi-factor authentication.
      </p>

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
        (SECURITY.md 6). Sign-in is implemented in Phase 2.
      </p>
    </section>
  );
}
