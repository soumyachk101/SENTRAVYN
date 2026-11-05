'use client';

import Link from 'next/link';
import { roleAtLeast, useSession } from '@/lib/session';
import { Badge } from '@/lib/ui';

const NAV: Array<{
  href: string;
  label: string;
  minRole: 'any' | 'REVIEWER' | 'ADMIN';
}> = [
  { href: '/', label: 'Overview', minRole: 'any' },
  { href: '/review', label: 'Review', minRole: 'REVIEWER' },
  { href: '/guides', label: 'Guides', minRole: 'REVIEWER' },
  { href: '/providers', label: 'Providers', minRole: 'any' },
  { href: '/audit', label: 'Audit', minRole: 'ADMIN' },
  { href: '/security', label: 'Security', minRole: 'any' },
];

/**
 * Console header: brand mark, role-aware navigation and the live session
 * status (role badge + sign in / sign out). Server-side RBAC remains the
 * source of truth; this only shapes what the user can see and reach.
 */
export function Header() {
  const { user, loading, signOut } = useSession();

  return (
    <header className="site-header">
      <div className="site-header__brand">
        <Link href="/" className="site-header__name">
          SENTRAVYN
        </Link>
        <span className="site-header__sub">Administration</span>
      </div>

      <nav className="site-header__nav" aria-label="Primary">
        {NAV.map((item) => {
          const gated =
            item.minRole !== 'any'
              ? !roleAtLeast(user?.role, item.minRole)
              : false;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="site-header__link"
            >
              {item.label}
              {gated ? (
                <span
                  className="site-header__lock"
                  title="Requires a higher role"
                >
                  requires higher role
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="site-header__status">
        {loading ? (
          <Badge tone="muted">Checking session…</Badge>
        ) : user ? (
          <>
            <Badge tone={user.role === 'ADMIN' ? 'warn' : 'neutral'}>
              {user.role}
            </Badge>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link className="btn btn--primary btn--sm" href="/login">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
