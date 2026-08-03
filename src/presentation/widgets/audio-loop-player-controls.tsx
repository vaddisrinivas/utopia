import { Pressable, StyleSheet, Text, View } from 'react-native';

export type AudioLoopLoopMode = 'finite' | 'infinite';

export function AudioLoopLoopModeControl({
  mode,
  onModeChange,
  disabled = false,
}: {
  mode: AudioLoopLoopMode;
  onModeChange: (mode: AudioLoopLoopMode) => void;
  disabled?: boolean;
}) {
  return (
    <View accessibilityLabel="Loop mode" accessibilityRole="radiogroup" style={styles.container}>
      <Text style={styles.label}>Loop mode</Text>
      <View style={styles.options}>
        <Pressable
          accessibilityLabel="Finite loop"
          accessibilityRole="radio"
          accessibilityState={{ disabled, selected: mode === 'finite' }}
          disabled={disabled}
          onPress={() => onModeChange('finite')}
          style={[styles.option, mode === 'finite' ? styles.optionSelected : null, disabled ? styles.optionDisabled : null]}
        >
          <Text style={[styles.optionText, mode === 'finite' ? styles.optionTextSelected : null]}>Finite</Text>
          <Text style={[styles.optionHint, mode === 'finite' ? styles.optionHintSelected : null]}>Choose a count</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Infinite loop"
          accessibilityRole="radio"
          accessibilityState={{ disabled, selected: mode === 'infinite' }}
          disabled={disabled}
          onPress={() => onModeChange('infinite')}
          style={[styles.option, mode === 'infinite' ? styles.optionSelected : null, disabled ? styles.optionDisabled : null]}
        >
          <Text style={[styles.optionText, mode === 'infinite' ? styles.optionTextSelected : null]}>Infinite</Text>
          <Text style={[styles.optionHint, mode === 'infinite' ? styles.optionHintSelected : null]}>Until stopped</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: { color: '#241C16', fontSize: 14, fontWeight: '900' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { flexGrow: 1, minHeight: 58, minWidth: 132, justifyContent: 'center', borderRadius: 14, backgroundColor: '#F6F1E8', paddingHorizontal: 14, paddingVertical: 10 },
  optionSelected: { backgroundColor: '#241C16' },
  optionDisabled: { opacity: 0.55 },
  optionText: { color: '#241C16', fontSize: 15, fontWeight: '900' },
  optionTextSelected: { color: '#FFFFFF' },
  optionHint: { color: '#6D6257', fontSize: 11, fontWeight: '700', marginTop: 2 },
  optionHintSelected: { color: '#F6F1E8' },
});
