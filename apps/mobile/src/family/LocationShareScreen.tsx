import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getLastKnownPositionAsync,
  requestForegroundPermissionsAsync,
  type LocationObject,
} from 'expo-location';
import type { LocationShareView } from '@sentravyn/shared-types';
import {
  familyCreateLocationShare,
  familyLocationShares,
  familyRevokeLocationShare,
} from './client';
import { useSession } from './session';
import {
  Empty,
  ErrorState,
  Loading,
  Mono,
  SectionTitle,
  colors,
} from './components';
import { coordinateToSend, type ShareDraft } from './location-utils';

/**
 * Location-sharing consent flow (Phase 7, SECURITY.md 5).
 *
 * - Explicit consent: the user states WHO (recipient) and WHY (purpose) and
 *   picks a bounded EXPIRY. Nothing is shared until they tap "Share now".
 * - "Stop" revokes the share immediately (audited server-side).
 * - Precision is minimised: the raw device coordinate is only sent when the
 *   draft is active AND precise is consented (coordinateToSend, pure helper).
 *   Otherwise only a coarse ~110 m value is recorded. Nothing precise is
 *   ever sent to analytics or logs.
 * - No background tracking: we read a one-shot last-known position at the
 *   moment of need, foreground only.
 * - A last-shared timestamp and an offline note are shown on each share.
 */
type ScreenPhase =
  | { status: 'loading' }
  | { status: 'ready'; shares: LocationShareView[] }
  | { status: 'error'; message: string };

export function LocationShareScreen() {
  const { state: session, signOut } = useSession();
  const token = session.status === 'signed-in' ? session.accessToken : '';

  const [phase, setPhase] = useState<ScreenPhase>({ status: 'loading' });

  // Draft form (one share at a time).
  const [recipient, setRecipient] = useState('');
  const [purpose, setPurpose] = useState('');
  const [expiry, setExpiry] = useState('1 hour');
  const [precise, setPrecise] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingError, setCreatingError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (token === '') return;
    setPhase({ status: 'loading' });
    try {
      const shares = await familyLocationShares(token);
      setPhase({ status: 'ready', shares });
    } catch {
      setPhase({
        status: 'error',
        message: 'Could not load location shares. The API may be unreachable.',
      });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeShare = useMemo(() => {
    if (phase.status !== 'ready') return null;
    return phase.shares.find((s) => s.active) ?? null;
  }, [phase]);

  /** Build the draft from the form (for the precision gate). */
  function draft(): ShareDraft {
    const hours = expiryHours(expiry);
    return {
      recipient: recipient.trim(),
      purpose: purpose.trim(),
      expiresAtIso: new Date(Date.now() + hours * 3600_000).toISOString(),
      precision: precise ? 'precise' : 'approximate',
      consented: true,
      revoked: false,
    };
  }

  async function shareNow() {
    if (token === '' || creating) return;
    const d = draft();
    if (d.recipient === '' || d.purpose === '') {
      setCreatingError('Both a recipient and a purpose are required.');
      return;
    }
    setCreatingError(null);
    setCreating(true);
    try {
      // Ask for the foreground location at the moment of need (SECURITY 5).
      const perm = await requestForegroundPermissionsAsync();
      let coords: LocationObject | null = null;
      if (perm.granted) {
        coords = await getLastKnownPositionAsync();
      }
      // If we have a position, send only what the consent model allows:
      // precise only when the draft is precise AND active, else coarse.
      let lastKnownLat: string | undefined;
      let lastKnownLng: string | undefined;
      if (coords !== null && coords !== undefined) {
        const sent = coordinateToSend(
          { lat: coords.coords.latitude, lng: coords.coords.longitude },
          d,
          new Date(),
        );
        lastKnownLat = String(sent.lat);
        lastKnownLng = String(sent.lng);
      }
      await familyCreateLocationShare(
        {
          recipient: d.recipient,
          purpose: d.purpose,
          expiresAt: d.expiresAtIso,
          preciseConsent: d.precision === 'precise',
          lastKnownLat,
          lastKnownLng,
        },
        token,
      );
      setRecipient('');
      setPurpose('');
      setPrecise(false);
      await load();
    } catch {
      setCreatingError('Could not create the share. Try again.');
    } finally {
      setCreating(false);
    }
  }

  async function stop(share: LocationShareView) {
    if (token === '') return;
    Alert.alert(
      'Stop sharing',
      `Stop location sharing with ${share.recipient}? This takes effect immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            try {
              await familyRevokeLocationShare(share.id, token);
              await load();
            } catch {
              Alert.alert('Could not stop sharing', 'The request failed. Check your connection.');
            }
          },
        },
      ],
    );
  }

  const shares = phase.status === 'ready' ? phase.shares : [];

  return (
    <View style={styles.root}>
      <SectionTitle>Location sharing</SectionTitle>

      {phase.status === 'loading' && <Loading label="Loading location shares…" />}
      {phase.status === 'error' && (
        <ErrorState title="Something went wrong" body={phase.message} onRetry={load} />
      )}

      {phase.status === 'ready' && (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* The clear "share now / stop" control */}
          <View style={styles.control}>
            <Text style={styles.controlTitle}>
              {activeShare ? 'Sharing your location' : 'Share your location now'}
            </Text>
            {activeShare ? (
              <Text style={styles.controlBody}>
                With {activeShare.recipient}, until {new Date(activeShare.expiresAt).toLocaleString()}
              </Text>
            ) : (
              <Text style={styles.controlBody}>
                Choose who, why, and for how long. No location is sent until you confirm.
              </Text>
            )}
            <View style={styles.controlButtons}>
              <Text
                style={[styles.btn, activeShare ? styles.btnStop : styles.btnGo]}
                accessibilityRole="button"
                onPress={() => {
                  if (activeShare) void stop(activeShare);
                  else void shareNow();
                }}
              >
                {activeShare ? 'Stop sharing' : 'Share now'}
              </Text>
            </View>
          </View>

          {activeShare === null && (
            <View style={styles.form} testID="share-form">
              <Text style={styles.formTitle}>New share</Text>
              <TextInput
                style={styles.input}
                value={recipient}
                onChangeText={setRecipient}
                placeholder="Recipient (e.g. my partner)"
                placeholderTextColor={colors.slate500}
                accessibilityLabel="Recipient"
              />
              <TextInput
                style={styles.input}
                value={purpose}
                onChangeText={setPurpose}
                placeholder="Purpose (why are you sharing?)"
                placeholderTextColor={colors.slate500}
                accessibilityLabel="Purpose"
              />
              <View style={styles.row}>
                <Text style={styles.label}>Expires in</Text>
                <Text
                  style={[styles.expBtn, expiry === '1 hour' ? styles.expOn : null]}
                  accessibilityRole="button"
                  onPress={() => setExpiry('1 hour')}
                >
                  1h
                </Text>
                <Text
                  style={[styles.expBtn, expiry === '6 hours' ? styles.expOn : null]}
                  accessibilityRole="button"
                  onPress={() => setExpiry('6 hours')}
                >
                  6h
                </Text>
                <Text
                  style={[styles.expBtn, expiry === '24 hours' ? styles.expOn : null]}
                  accessibilityRole="button"
                  onPress={() => setExpiry('24 hours')}
                >
                  24h
                </Text>
              </View>
              <Text
                style={styles.consentText}
                accessibilityRole="button"
                accessibilityState={{ selected: precise }}
                onPress={() => setPrecise((p) => !p)}
              >
                {precise ? 'Precise location' : 'Coarse location'} —{' '}
                {precise
                  ? 'a precise coordinate is shared only for this share and never logged'
                  : 'only an approximate (~110 m) position is recorded'}
              </Text>
              {creatingError !== null ? (
                <Text style={styles.errText}>{creatingError}</Text>
              ) : null}
            </View>
          )}

          {/* Existing shares with their state, last-shared time, and stop control */}
          <SectionTitle>Your shares</SectionTitle>
          {shares.length === 0 ? (
            <Empty
              title="No location shares"
              body="Nothing is being shared right now. Create a share to let a named person see your location for a bounded time."
            />
          ) : (
            shares.map((s) => (
              <View key={s.id} style={styles.shareCard}>
                <View style={styles.shareHead}>
                  <Text style={styles.shareName}>{s.recipient}</Text>
                  <Mono color={s.active ? colors.okGreen : colors.slate500}>
                    {s.active ? 'ACTIVE' : s.revoked ? 'REVOKED' : 'EXPIRED'}
                  </Mono>
                </View>
                <Text style={styles.sharePurpose}>{s.purpose}</Text>
                <Text style={styles.shareMeta}>
                  {s.lastKnownAt ? `last shared ${new Date(s.lastKnownAt).toLocaleString()}` : 'no position recorded yet'}
                  {'  ·  '}
                  {s.preciseConsent ? 'precise consent' : 'coarse only'}
                  {'  ·  '}
                  {s.active
                    ? `until ${new Date(s.expiresAt).toLocaleString()}`
                    : s.revoked
                      ? `stopped ${s.revokedAt ? new Date(s.revokedAt).toLocaleString() : ''}`
                      : 'expired'}
                </Text>
                <Text style={styles.offlineNote}>
                  If you go offline, your location is not sent; it resumes when you reconnect.
                </Text>
                {s.active ? (
                  <Text style={[styles.stopBtn, { color: colors.alertRed }]} accessibilityRole="button" onPress={() => void stop(s)}>
                    Stop sharing now
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Text style={styles.signOut} accessibilityRole="button" onPress={signOut}>
          Sign out
        </Text>
      </View>
    </View>
  );
}

function expiryHours(label: string): number {
  if (label === '6 hours') return 6;
  if (label === '24 hours') return 24;
  return 1;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink900, padding: 20 },
  scroll: { gap: 12, paddingTop: 10 },
  control: {
    backgroundColor: colors.ink800,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(74,107,130,0.4)',
  },
  controlTitle: { color: colors.paper50, fontSize: 15, fontWeight: '600' },
  controlBody: { color: colors.slate300, fontSize: 13 },
  controlButtons: { flexDirection: 'row', marginTop: 4 },
  btn: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'monospace',
    fontSize: 14,
    paddingVertical: 14,
    borderRadius: 8,
    color: colors.paper50,
  },
  btnGo: { backgroundColor: colors.accentCalm },
  btnStop: { backgroundColor: colors.alertRed },
  form: {
    backgroundColor: colors.ink800,
    borderRadius: 12,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.22)',
  },
  formTitle: { color: colors.paper50, fontFamily: 'monospace', fontSize: 13 },
  input: {
    backgroundColor: colors.ink900,
    color: colors.paper50,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.35)',
    fontSize: 15,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: colors.slate300, fontSize: 13, marginRight: 4 },
  expBtn: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: colors.slate300,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.35)',
    minWidth: 44,
    textAlign: 'center',
  },
  expOn: { backgroundColor: colors.ink700, color: colors.paper50 },
  consentText: { fontSize: 13, color: colors.slate300, lineHeight: 18 },
  errText: { color: colors.alertRed, fontSize: 13 },
  shareCard: {
    backgroundColor: colors.ink800,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.22)',
  },
  shareHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shareName: { color: colors.paper50, fontSize: 15, fontWeight: '600' },
  sharePurpose: { color: colors.slate300, fontSize: 13 },
  shareMeta: { color: colors.slate500, fontFamily: 'monospace', fontSize: 11 },
  offlineNote: { color: colors.slate500, fontSize: 11, fontStyle: 'italic' },
  stopBtn: { color: colors.alertRed, fontFamily: 'monospace', fontSize: 13, marginTop: 4 },
  footer: {
    position: 'absolute',
    bottom: 20,
    right: 20,
  },
  signOut: { color: colors.slate500, fontFamily: 'monospace', fontSize: 12 },
});
