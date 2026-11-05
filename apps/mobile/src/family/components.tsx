import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { VerificationLabel } from '@sentravyn/shared-types';
import { colors, spacing, verificationColor } from './theme';

/**
 * Shared family-safety building blocks (Phase 7). Plain View/Text primitives,
 * DESIGN.md tokens, no emoji, no neon. Color is never the only signal: every
 * verification state also carries a text label (VERIFICATION_LABEL).
 */

export const VERIFICATION_LABEL: Record<VerificationLabel, string> = {
  VERIFIED: 'Verified',
  REVIEWED: 'Reviewed',
  UNVERIFIED: 'Unverified',
  STALE: 'Stale',
  EXPIRED: 'Expired',
  INCOMPLETE: 'Incomplete',
};

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.screen}>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** A loading state (CLAUDE.md rule 10: every data view has a loading state). */
export function Loading({ label }: { label: string }) {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.accentCalm} />
      <Text style={styles.stateLabel}>{label}</Text>
    </View>
  );
}

/** An empty state: honest about incomplete coverage, never fabricates data. */
export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.state}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.stateLabel}>{body}</Text>
    </View>
  );
}

/** An error state with a retry control (every control must work, rule 9). */
export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <View style={[styles.state, { borderColor: colors.alertRed }]}>
      <Text style={[styles.emptyTitle, { color: colors.alertRed }]}>
        {title}
      </Text>
      <Text style={styles.stateLabel}>{body}</Text>
      {onRetry ? (
        <View style={styles.retryRow}>
          <Text
            style={styles.retry}
            onPress={onRetry}
            accessibilityRole="button"
          >
            Retry
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** An offline state: the API is unreachable, data is not being shown as live. */
export function OfflineState({ body }: { body: string }) {
  return (
    <View style={styles.state}>
      <Text style={styles.emptyTitle}>Offline</Text>
      <Text style={styles.stateLabel}>{body}</Text>
    </View>
  );
}

/**
 * A verification-state chip: a required text label plus a muted colour
 * support. Colour is never the only channel (DESIGN.md 3 / SAFETY-POLICY 8).
 */
export function VerificationChip({ label }: { label: VerificationLabel }) {
  const c = verificationColor[label] ?? colors.slate300;
  return (
    <View
      style={[styles.chip, { borderColor: c, backgroundColor: `${c}22` }]}
      accessibilityLabel={`Verification status: ${VERIFICATION_LABEL[label]}`}
    >
      <View style={[styles.chipDot, { backgroundColor: c }]} />
      <Text style={[styles.chipText, { color: c }]}>
        {VERIFICATION_LABEL[label]}
      </Text>
    </View>
  );
}

/** Monospace technical metadata (timestamps, ids). */
export function Mono({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <Text
      style={[
        styles.mono,
        { fontFamily: 'monospace' },
        { color: color ?? colors.slate500 },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink900,
    paddingVertical: spacing.xl,
  },
  body: { flex: 1 },
  sectionTitle: {
    color: colors.paper50,
    fontFamily: 'monospace',
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontSize: 12,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  state: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderColor: 'rgba(85,96,108,0.22)',
    borderRadius: 12,
    borderWidth: 1,
  },
  stateLabel: {
    color: colors.slate300,
    textAlign: 'center',
    fontSize: 14,
  },
  emptyTitle: {
    color: colors.paper50,
    fontSize: 17,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  retryRow: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: colors.accentCalm,
    minWidth: 120,
    alignItems: 'center',
  },
  retry: {
    color: colors.paper50,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontFamily: 'monospace', fontSize: 12, letterSpacing: 1 },
  mono: { fontSize: 12, letterSpacing: 0.5 },
});

export { colors };
