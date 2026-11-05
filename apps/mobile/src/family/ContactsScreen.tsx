import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { EmergencyContactView } from '@sentravyn/shared-types';
import {
  familyContacts,
  familyCreateContact,
  familyDeleteContact,
  familyUpdateContact,
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

/**
 * Emergency contacts (Phase 7). The user's OWN contacts, add/edit/delete.
 * Object-level authorisation is enforced server-side (only the owner can
 * read or mutate these rows); the UI just presents them.
 *
 * Every control works (rule 9): list, add, edit (PATCH), delete (with a
 * native confirm). Loading/empty/error states all render (rule 10).
 */
type Editing =
  | { kind: 'new' }
  | { kind: 'edit'; contact: EmergencyContactView };

export function ContactsScreen() {
  const { state: session, signOut } = useSession();
  const token = session.status === 'signed-in' ? session.accessToken : '';

  const [contacts, setContacts] = useState<EmergencyContactView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  // Draft fields (shared by add and edit).
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);

  const load = useCallback(async () => {
    if (token === '') return;
    setLoading(true);
    setError(null);
    try {
      const rows = await familyContacts(token);
      setContacts(rows);
    } catch {
      setError('Could not load your emergency contacts. The API may be unreachable.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setName('');
    setRelation('');
    setPhone('');
    setConsent(false);
    setEditing({ kind: 'new' });
  }

  function openEdit(c: EmergencyContactView) {
    setName(c.name);
    setRelation(c.relation ?? '');
    setPhone(c.phone ?? '');
    setConsent(c.consent);
    setEditing({ kind: 'edit', contact: c });
  }

  async function save() {
    if (token === '' || editing === null) return;
    const payload = {
      name: name.trim(),
      relation: relation.trim() || undefined,
      phone: phone.trim() || undefined,
      consent,
    };
    if (payload.name === '') {
      Alert.alert('Name required', 'A contact needs a name.');
      return;
    }
    try {
      if (editing.kind === 'new') {
        await familyCreateContact(payload, token);
      } else {
        await familyUpdateContact(editing.contact.id, payload, token);
      }
      setEditing(null);
      await load();
    } catch {
      setError('Could not save the contact. Try again.');
    }
  }

  async function remove(c: EmergencyContactView) {
    if (token === '') return;
    Alert.alert(
      'Delete contact',
      `Remove "${c.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await familyDeleteContact(c.id, token);
              await load();
            } catch {
              setError('Could not delete the contact. Try again.');
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <SectionTitle>Emergency contacts</SectionTitle>

      {loading && <Loading label="Loading your contacts…" />}

      {error !== null && !loading && (
        <ErrorState title="Something went wrong" body={error} onRetry={load} />
      )}

      {!loading && error === null && contacts !== null && (
        <ScrollView contentContainerStyle={styles.list}>
          {contacts.length === 0 ? (
            <Empty
              title="No emergency contacts yet"
              body="Add the people you would call in an emergency. They are stored under your own account only."
            />
          ) : (
            contacts.map((c) => (
              <View key={c.id} style={styles.card}>
                <Text style={styles.name}>{c.name}</Text>
                <View style={styles.metaRow}>
                  {c.relation ? <Mono>{c.relation}</Mono> : null}
                  {c.phone ? <Mono>{c.phone}</Mono> : null}
                </View>
                <View style={styles.actions}>
                  <Text style={styles.action} accessibilityRole="button" onPress={() => openEdit(c)}>
                    Edit
                  </Text>
                  <Text style={[styles.action, { color: colors.alertRed }]} accessibilityRole="button" onPress={() => remove(c)}>
                    Delete
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {editing !== null && (
        <View style={styles.editor} testID="contact-editor">
          <Text style={styles.editorTitle}>
            {editing.kind === 'new' ? 'Add contact' : 'Edit contact'}
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={colors.slate500}
            accessibilityLabel="Contact name"
          />
          <TextInput
            style={styles.input}
            value={relation}
            onChangeText={setRelation}
            placeholder="Relationship (optional)"
            placeholderTextColor={colors.slate500}
            accessibilityLabel="Relationship"
          />
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone (optional)"
            placeholderTextColor={colors.slate500}
            keyboardType="phone-pad"
            accessibilityLabel="Phone number"
          />
          <View style={styles.consentRow}>
            <Text
              style={[styles.consentText, { color: consent ? colors.okGreen : colors.slate300 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: consent }}
              onPress={() => setConsent((c) => !c)}
            >
              {consent ? 'Selected' : 'Not selected'} — this person has consented to be contacted by SENTRAVYN for emergencies
            </Text>
          </View>
          <View style={styles.editorActions}>
            <Text style={styles.action} accessibilityRole="button" onPress={() => setEditing(null)}>
              Cancel
            </Text>
            <Text style={[styles.action, { color: colors.accentCalm }]} accessibilityRole="button" onPress={save}>
              Save
            </Text>
          </View>
        </View>
      )}

      <View style={styles.footer}>
        <Text
          style={styles.addBtn}
          accessibilityRole="button"
          onPress={openNew}
          disabled={editing !== null}
        >
          + Add emergency contact
        </Text>
        <Text style={styles.signOut} accessibilityRole="button" onPress={signOut}>
          Sign out
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink900, padding: 20 },
  list: { gap: 10, paddingTop: 10 },
  card: {
    backgroundColor: colors.ink800,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.22)',
  },
  name: { color: colors.paper50, fontSize: 16, fontWeight: '600' },
  metaRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: 16, marginTop: 4 },
  action: { color: colors.slate300, fontSize: 13, fontFamily: 'monospace' },
  editor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.ink800,
    borderTopWidth: 1,
    borderTopColor: 'rgba(85,96,108,0.4)',
    padding: 20,
    gap: 10,
  },
  editorTitle: { color: colors.paper50, fontFamily: 'monospace', fontSize: 14 },
  input: {
    backgroundColor: colors.ink900,
    color: colors.paper50,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.35)',
    fontSize: 15,
  },
  consentRow: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.ink900,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.35)',
  },
  consentText: { fontSize: 13, lineHeight: 18 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 4 },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addBtn: {
    color: colors.paper50,
    fontFamily: 'monospace',
    fontSize: 14,
    backgroundColor: colors.accentCalm,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  signOut: { color: colors.slate500, fontFamily: 'monospace', fontSize: 12 },
});
