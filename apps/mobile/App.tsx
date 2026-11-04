import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// SENTRAVYN mobile shell (Phase 1 foundation).
// Design tokens and background treatment are the mobile v0 equivalent of the
// web shell; feature surfaces (maps, alerts, family safety) land in later
// phases. No live data is rendered here.
const DISCLAIMER =
  'SENTRAVYN is an information and preparedness platform, not an operational ' +
  'emergency service. A nearby place is not automatically a safe shelter.';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.tagline}>
        Know Where to Go. Know What to Do. Stay Prepared.
      </Text>
      <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
      <Text style={styles.artworkNote}>PREPAREDNESS SAVES LIVES.</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101418', // ink900 atmospheric neutral (DESIGN.md 3)
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  tagline: {
    color: '#f7f5f1',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  disclaimer: {
    color: '#aab3bf',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  artworkNote: {
    color: '#55606c',
    fontSize: 12,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
});
