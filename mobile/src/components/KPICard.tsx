import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/colors';

type Props = {
  label: string;
  value: string | number;
  note?: string;
  testID?: string;
};

export default function KPICard({ label, value, note, testID }: Props) {
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    padding: 16,
    flex: 1,
    minWidth: 140,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  value: {
    fontSize: 24,
    fontWeight: '900',
    color: Colors.charcoal,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  note: {
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginTop: 4,
  },
});
