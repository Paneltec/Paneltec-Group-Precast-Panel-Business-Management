import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/contexts/AuthContext';
import { api, formatApiErrorDetail } from '../src/lib/api';
import { Colors } from '../src/lib/colors';

export default function ForcePasswordChangeScreen() {
  const { user, logout, refresh } = useAuth();
  const router = useRouter();
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async () => {
    setError('');
    if (newPwd !== confirm) { setError("New passwords don't match"); return; }
    if (newPwd.length < 8) { setError('New password must be at least 8 characters'); return; }
    setSubmitting(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { current_password: currentPwd, new_password: newPwd },
      });
      await refresh();
      router.replace('/');
    } catch (err: any) {
      setError(formatApiErrorDetail(err?.data?.detail) || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="force-password-change-page"
      >
        {/* Header */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="lock-closed" size={22} color={Colors.charcoal} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.overline}>ACTION REQUIRED</Text>
              <Text style={styles.title}>Change your password</Text>
            </View>
          </View>

          <Text style={styles.body}>
            Hi <Text style={styles.bold}>{user?.name}</Text> — your account has been flagged for a password change. Set a new password to continue.
          </Text>

          {/* Current Password */}
          <Text style={styles.label}>CURRENT PASSWORD</Text>
          <TextInput
            testID="fpc-current"
            style={styles.input}
            secureTextEntry
            value={currentPwd}
            onChangeText={setCurrentPwd}
            placeholder="Enter current password"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
          />

          {/* New Password */}
          <Text style={styles.label}>NEW PASSWORD</Text>
          <TextInput
            testID="fpc-new"
            style={styles.input}
            secureTextEntry
            value={newPwd}
            onChangeText={setNewPwd}
            placeholder="Min. 8 characters"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
          />

          {/* Confirm Password */}
          <Text style={styles.label}>CONFIRM NEW PASSWORD</Text>
          <TextInput
            testID="fpc-confirm"
            style={styles.input}
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter new password"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
          />

          {error ? (
            <Text style={styles.error} testID="fpc-error">{error}</Text>
          ) : null}

          {/* Footer row */}
          <View style={styles.footerRow}>
            <TouchableOpacity onPress={onLogout} testID="fpc-logout" activeOpacity={0.7}>
              <View style={styles.logoutRow}>
                <Ionicons name="log-out-outline" size={14} color={Colors.textMuted} />
                <Text style={styles.logoutText}>Log out instead</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              testID="fpc-submit"
              style={[styles.submitBtn, submitting && styles.btnDisabled]}
              onPress={onSubmit}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.charcoal} size="small" />
              ) : (
                <Text style={styles.submitText}>Update password</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: Colors.charcoal },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.safetyYellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  overline: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.steelBlue,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: Colors.charcoal,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  body: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginBottom: 20 },
  bold: { fontWeight: '700' },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.steelBlue,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 14,
    fontSize: 15,
    color: Colors.charcoal,
    backgroundColor: Colors.background,
  },
  error: {
    fontSize: 13,
    color: '#DC2626',
    marginTop: 12,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  logoutText: { fontSize: 12, color: Colors.textMuted },
  submitBtn: {
    backgroundColor: Colors.safetyYellow,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
    minWidth: 140,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  submitText: { fontSize: 14, fontWeight: '800', color: Colors.charcoal },
});
