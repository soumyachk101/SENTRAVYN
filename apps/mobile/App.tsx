import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SessionProvider, useSession } from './src/family/session';
import { SignInScreen } from './src/family/SignInScreen';
import { ContactsScreen } from './src/family/ContactsScreen';
import { LocationShareScreen } from './src/family/LocationShareScreen';
import { HouseholdPlanScreen } from './src/family/HouseholdPlanScreen';
import { colors, DISCLAIMER } from './src/family/theme';

type Section = 'contacts' | 'location' | 'household';

/**
 * SENTRAVYN mobile shell (Phase 7 family safety).
 *
 * A working section shell: sign in (the SessionProvider gate) to manage your
 * OWN emergency contacts, location shares and household plan. No dead
 * buttons — every control renders a real screen (CLAUDE.md rule 9). The
 * design system (DESIGN.md 3: no neon, monospace metadata) and the custom
 * dark background carry through the whole surface. No emoji anywhere.
 */

function FamilyShell() {
  const { state } = useSession();
  const [section, setSection] = useState<Section>('contacts');

  if (state.status !== 'signed-in') {
    return (
      <View style={styles.root}>
        <SignInScreen />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Section picker — a real control that switches the rendered screen. */}
      <View style={styles.tabs} role="tablist" accessibilityRole="tablist">
        <TabButton
          label="Contacts"
          active={section === 'contacts'}
          onPress={() => setSection('contacts')}
        />
        <TabButton
          label="Location"
          active={section === 'location'}
          onPress={() => setSection('location')}
        />
        <TabButton
          label="Plan"
          active={section === 'household'}
          onPress={() => setSection('household')}
        />
      </View>

      <View style={styles.content}>
        {section === 'contacts' && <ContactsScreen />}
        {section === 'location' && <LocationShareScreen />}
        {section === 'household' && <HouseholdPlanScreen />}
      </View>

      <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
      <StatusBar style="light" />
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Text
      style={[styles.tab, active && styles.tabActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
    >
      {label}
    </Text>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <FamilyShell />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink900,
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 1,
    color: colors.slate300,
    backgroundColor: colors.ink800,
    borderRadius: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(85,96,108,0.22)',
  },
  tabActive: {
    color: colors.paper50,
    backgroundColor: colors.ink700,
    borderColor: 'rgba(74,107,130,0.6)',
  },
  content: { flex: 1 },
  disclaimer: {
    color: colors.slate500,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 15,
  },
});
