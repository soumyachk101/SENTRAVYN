import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  HouseholdPlanInput,
  HouseholdPlanView,
} from '@sentravyn/shared-types';
import {
  familyHouseholdPlan,
  familyUpsertHouseholdPlan,
} from './client';
import { useSession } from './session';
import {
  Empty,
  ErrorState,
  Loading,
  SectionTitle,
  colors,
} from './components';

/**
 * Household plan (Phase 7). The user's own preparedness data: a meeting
 * point, a kit checklist and pet considerations. This is the user's own
 * scratch data, not a live operational claim — it is stored under their
 * account and requires no review.
 *
 * All fields are optional and a partial save keeps the rest. The checklist
 * is a validated array of { label, done }; every control works (rule 9).
 */
type Phase =
  | { status: 'loading' }
  | { status: 'ready'; plan: HouseholdPlanView | null }
  | { status: 'error'; message: string };

export function HouseholdPlanScreen() {
  const { state: session, signOut } = useSession();
  const token = session.status === 'signed-in' ? session.accessToken : '';

  const [phase, setPhase] = useState<Phase>({ status: 'loading' });

  // Editable draft fields.
  const [meetingPoint, setMeetingPoint] = useState('');
  const [meetingPointNote, setMeetingPointNote] = useState('');
  const [petConsiderations, setPetConsiderations] = useState('');
  const [kit, setKit] = useState<{ label: string; done: boolean }[]>([]);
  const [newItem, setNewItem] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (token === '') return;
    setPhase({ status: 'loading' });
    try {
      const plan = await familyHouseholdPlan(token);
      setPhase({ status: 'ready', plan });
      if (plan !== null) {
        setMeetingPoint(plan.meetingPoint ?? '');
        setMeetingPointNote(plan.meetingPointNote ?? '');
        setPetConsiderations(plan.petConsiderations ?? '');
        setKit(plan.kitChecklist ?? []);
      } else {
        setMeetingPoint('');
        setMeetingPointNote('');
        setPetConsiderations('');
        setKit([]);
      }
    } catch {
      setPhase({
        status: 'error',
        message: 'Could not load your household plan. The API may be unreachable.',
      });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function addKitItem() {
    const label = newItem.trim();
    if (label === '') return;
    setKit((k) => [...k, { label, done: false }]);
    setNewItem('');
  }

  function toggleKit(index: number) {
    setKit((k) => k.map((i, j) => (j === index ? { ...i, done: !i.done } : i)));
  }

  function removeKitItem(index: number) {
    setKit((k) => k.filter((_, j) => j !== index));
  }

  async function save() {
    if (token === '' || saving) return;
    setSaving(true);
    setSaveError(null);
    const payload: HouseholdPlanInput = {
      meetingPoint: meetingPoint.trim() || undefined,
      meetingPointNote: meetingPointNote.trim() || undefined,
      kitChecklist: kit,
      petConsiderations: petConsiderations.trim() || undefined,
    };
    try {
      await familyUpsertHouseholdPlan(payload, token);
      await load();
      Alert.alert('Saved', 'Your household plan was updated.');
    } catch {
      setSaveError('Could not save your plan. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const hasPlan = phase.status === 'ready' && phase.plan !== null;

  return (
    <View style={styles.root}>
      <SectionTitle>Household plan</SectionTitle>

      {phase.status === 'loading' && <Loading label="Loading your plan…" />}
      {phase.status === 'error' && (
        <ErrorState title="Something went wrong" body={phase.message} onRetry={load} />
      )}

      {phase.status === 'ready' && (
        <ScrollView contentContainerStyle={styles.scroll}>
          {!hasPlan && (
            <Empty
              title="No household plan yet"
              body="Set a meeting point and start a kit checklist. This is your own preparedness data, kept under your account."
            />
          )}

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Meeting point</Text>
            <TextInput
              style={styles.input}
              value={meetingPoint}
              onChangeText={setMeetingPoint}
              placeholder="Where your household meets"
              placeholderTextColor={colors.slate500}
              accessibilityLabel="Meeting point"
            />
            <TextInput
              style={styles.input}
              value={meetingPointNote}
              onChangeText={setMeetingPointNote}
              placeholder="Note (optional)"
              placeholderTextColor={colors.slate500}
              accessibilityLabel="Meeting point note"
            />
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Kit checklist</Text>
            {kit.length === 0 ? (
              <Text style={styles.emptyInline}>No items yet. Add one below.</Text>
            ) : (
              kit.map((item, i) => (
                <View key={`${item.label}-${i}`} style={styles.kitRow}>
                  <Text
                    style={[
                      styles.kitText,
                      item.done && { color: colors.slate500, textDecorationLine: 'line-through' },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: item.done }}
                    onPress={() => toggleKit(i)}
                  >
                    {item.done ? '[x]' : '[ ]'} {item.label}
                  </Text>
                  <Text
                    style={[styles.kitRemove, { color: colors.alertRed }]}
                    accessibilityRole="button"
                    onPress={() => removeKitItem(i)}
                  >
                    Remove
                  </Text>
                </View>
              ))
            )}
            <View style={styles.kitAddRow}>
              <TextInput
                style={styles.kitInput}
                value={newItem}
                onChangeText={setNewItem}
                placeholder="Add a kit item"
                placeholderTextColor={colors.slate500}
                accessibilityLabel="New kit item"
              />
              <Text style={styles.addBtn} accessibilityRole="button" onPress={addKitItem}>
                Add
              </Text>
            </View>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Pets</Text>
            <TextInput
              style={styles.input}
              value={petConsiderations}
              onChangeText={setPetConsiderations}
              placeholder="How you will care for your pets (optional)"
              placeholderTextColor={colors.slate500}
              accessibilityLabel="Pet considerations"
            />
          </View>

          {saveError !== null ? <Text style={styles.err}>{saveError}</Text> : null}

          <View style={styles.saveRow}>
            <Text
              style={styles.saveBtn}
              accessibilityRole="button"
              onPress={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save plan'}
            </Text>
          </View>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink900, padding: 20 },
  scroll: { gap: 14, paddingTop: 10 },
  block: {
    backgroundColor: colors.ink800,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.22)',
  },
  blockTitle: { color: colors.paper50, fontFamily: 'monospace', fontSize: 13, letterSpacing: 1 },
  input: {
    backgroundColor: colors.ink900,
    color: colors.paper50,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.35)',
    fontSize: 15,
  },
  emptyInline: { color: colors.slate500, fontSize: 13 },
  kitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  kitText: {
    color: colors.paper50,
    fontFamily: 'monospace',
    fontSize: 13,
    flex: 1,
  },
  kitRemove: { color: colors.alertRed, fontFamily: 'monospace', fontSize: 12 },
  kitAddRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  kitInput: {
    flex: 1,
    backgroundColor: colors.ink900,
    color: colors.paper50,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.35)',
    fontSize: 14,
  },
  addBtn: {
    color: colors.paper50,
    fontFamily: 'monospace',
    fontSize: 13,
    backgroundColor: colors.accentCalm,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  err: { color: colors.alertRed, fontSize: 13 },
  saveRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  saveBtn: {
    color: colors.paper50,
    fontFamily: 'monospace',
    fontSize: 14,
    backgroundColor: colors.accentCalm,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  footer: { position: 'absolute', bottom: 20, right: 20 },
  signOut: { color: colors.slate500, fontFamily: 'monospace', fontSize: 12 },
});
