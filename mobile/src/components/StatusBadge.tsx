import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusColors } from '../lib/colors';

type Props = {
  status: string;
  testID?: string;
};

export default function StatusBadge({ status, testID }: Props) {
  if (!status) return null;
  const colors = StatusColors[status] || { bg: '#F3F4F6', text: '#374151' };
  const label = status.replace(/_/g, ' ');

  return (
    <View
      testID={testID}
      style={[styles.badge, { backgroundColor: colors.bg }]}
    >
      <Text style={[styles.text, { color: colors.text }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
