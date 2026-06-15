import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/colors';

type Props = {
  message: string;
  testID?: string;
};

export default function ErrorBanner({ message, testID }: Props) {
  if (!message) return null;
  return (
    <View style={styles.container} testID={testID || 'error-banner'}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.errorBg,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: {
    fontSize: 13,
    color: Colors.error,
  },
});
