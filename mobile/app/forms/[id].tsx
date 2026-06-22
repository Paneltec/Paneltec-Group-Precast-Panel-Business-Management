import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import FormDetailPanel from '../../src/components/FormDetailPanel';
import { Colors } from '../../src/lib/colors';

export default function FormDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FormDetailPanel formId={id} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
});
