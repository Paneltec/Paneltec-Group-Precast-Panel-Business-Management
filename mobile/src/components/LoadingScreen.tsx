import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/colors';

type Props = {
  message?: string;
};

export default function LoadingScreen({ message = 'Loading...' }: Props) {
  return (
    <View style={styles.container} testID="loading-screen">
      <ActivityIndicator size="large" color={Colors.steelBlue} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  text: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textMuted,
  },
});
