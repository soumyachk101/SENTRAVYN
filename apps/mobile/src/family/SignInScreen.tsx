import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DISCLAIMER } from './theme';
import { useSession } from './session';
import { colors } from './components';

/**
 * Sign-in gate for the family-safety surfaces (Phase 7 mobile).
 *
 * Smallest honest credential UI: sign in to an existing SENTRAVYN account to
 * manage your own family data. The token is held in memory only (session.tsx)
 * — not persisted, not sent to analytics, not logged (SECURITY.md 5 /
 * CLAUDE.md). No account creation is offered here; that is a separate,
 * out-of-scope concern.
 */
export function SignInScreen() {
  const { state, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const busy = state.status === 'loading';
  const error = state.status === 'error' ? state.message : null;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>SENTRAVYN</Text>
      <Text style={styles.sub}>Family safety</Text>
      <Text style={styles.disclaimer}>{DISCLAIMER}</Text>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={colors.slate500}
        keyboardType="email-address"
        autoCapitalize="none"
        accessibilityLabel="Email"
        editable={!busy}
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={colors.slate500}
        secureTextEntry
        accessibilityLabel="Password"
        editable={!busy}
      />

      {error !== null ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.btnRow}>
        <Text
          style={styles.btn}
          accessibilityRole="button"
          disabled={busy || email.trim() === '' || password === ''}
          onPress={() => void signIn(email.trim(), password)}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Text>
        {busy ? <ActivityIndicator color={colors.accentCalm} /> : null}
      </View>

      <Text style={styles.note}>
        Signing in lets you manage your own emergency contacts, location
        shares and household plan. Your data stays under your account.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink900,
    justifyContent: 'center',
    padding: 32,
    gap: 14,
  },
  title: {
    color: colors.paper50,
    fontFamily: 'monospace',
    fontSize: 28,
    letterSpacing: 4,
  },
  sub: {
    color: colors.accentCalm,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  disclaimer: { color: colors.slate500, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: colors.ink800,
    color: colors.paper50,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.35)',
    fontSize: 15,
  },
  error: { color: colors.alertRed, fontSize: 13 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btn: {
    color: colors.paper50,
    fontFamily: 'monospace',
    fontSize: 15,
    backgroundColor: colors.accentCalm,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  note: { color: colors.slate500, fontSize: 12, lineHeight: 17 },
});
