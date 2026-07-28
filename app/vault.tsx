import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors } from '@/src/theme';

export default function VaultScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Utopia vault</Text>
        <Text style={styles.title}>Offline backup restore</Text>
        <Text style={styles.muted}>
          This slice is wired for the web build. Native still needs a client-safe crypto path before encrypted vault restore can run on-device.
        </Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Available now</Text>
        <Text style={styles.body}>Open the web build and use `/vault` to export an encrypted package vault, preview it, and approve restore.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Back to app</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: 16, padding: 18, paddingTop: 48 },
  header: { gap: 4 },
  eyebrow: { color: colors.plum, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  muted: { color: colors.muted },
  section: { gap: 10, borderColor: colors.line, borderRadius: 8, borderWidth: 1, backgroundColor: colors.paper, padding: 12 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  body: { color: colors.ink, lineHeight: 20 },
  button: { alignSelf: 'flex-start', borderRadius: 8, backgroundColor: colors.plum, paddingHorizontal: 14, paddingVertical: 11 },
  buttonText: { color: '#FFFFFF', fontWeight: '900' },
});
