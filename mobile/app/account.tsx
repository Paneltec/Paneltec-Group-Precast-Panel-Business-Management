import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useAuth } from '../src/contexts/AuthContext';
import { api } from '../src/lib/api';
import { formatDateTime } from '../src/lib/format';
import { Colors } from '../src/lib/colors';

export default function AccountScreen() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => { setName(user?.name || ''); }, [user]);

  if (!user) return null;

  const saveProfile = async () => {
    if (name.trim() === user.name) return;
    setSavingProfile(true);
    try {
      await api('/users/me', { method: 'PATCH', body: { name: name.trim() } });
      await refresh();
      Alert.alert('Success', 'Profile updated');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (newPwd !== confirmPwd) {
      Alert.alert('Error', "Passwords don't match");
      return;
    }
    if (newPwd.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    setSavingPwd(true);
    try {
      await api('/users/me', {
        method: 'PATCH',
        body: { current_password: currentPwd, new_password: newPwd },
      });
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      Alert.alert('Success', 'Password updated');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingPwd(false);
    }
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
        testID="account-page"
      >
        {/* Profile */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PROFILE</Text>
          <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
          <TextInput
            testID="account-name"
            style={styles.input}
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.fieldLabel}>EMAIL</Text>
          <TextInput
            testID="account-email"
            style={[styles.input, styles.inputDisabled]}
            value={user.email}
            editable={false}
          />
          <Text style={styles.hint}>Read-only. Ask a super admin to change your email.</Text>

          <Text style={styles.fieldLabel}>ROLE</Text>
          <TextInput
            testID="account-role-label"
            style={[styles.input, styles.inputDisabled]}
            value={user.is_super_admin ? 'Super Admin' : user.role_label || 'Staff'}
            editable={false}
          />

          <Text style={styles.fieldLabel}>LAST LOGIN</Text>
          <TextInput
            testID="account-last-login"
            style={[styles.input, styles.inputDisabled]}
            value={user.last_login_at ? formatDateTime(user.last_login_at) : '\u2014'}
            editable={false}
          />

          <TouchableOpacity
            testID="account-save-profile"
            style={[styles.btnPrimary, (savingProfile || name.trim() === user.name) && styles.btnDisabled]}
            onPress={saveProfile}
            disabled={savingProfile || name.trim() === user.name}
            activeOpacity={0.8}
          >
            {savingProfile ? (
              <ActivityIndicator color={Colors.charcoal} size="small" />
            ) : (
              <Text style={styles.btnPrimaryText}>Save profile</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Password */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CHANGE PASSWORD</Text>
          <TextInput
            testID="account-current-pwd"
            style={styles.input}
            placeholder="Current password"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            value={currentPwd}
            onChangeText={setCurrentPwd}
          />
          <TextInput
            testID="account-new-pwd"
            style={[styles.input, { marginTop: 10 }]}
            placeholder="New password (min 8)"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            value={newPwd}
            onChangeText={setNewPwd}
          />
          <TextInput
            testID="account-confirm-pwd"
            style={[styles.input, { marginTop: 10 }]}
            placeholder="Confirm new password"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            value={confirmPwd}
            onChangeText={setConfirmPwd}
          />
          <TouchableOpacity
            testID="account-save-pwd"
            style={[styles.btnDark, savingPwd && styles.btnDisabled]}
            onPress={savePassword}
            disabled={savingPwd}
            activeOpacity={0.8}
          >
            {savingPwd ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.btnDarkText}>Update password</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Permissions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WHAT YOU CAN DO</Text>
          {user.is_super_admin ? (
            <View style={styles.superBanner} testID="account-super-banner">
              <Text style={styles.superBannerText}>
                You are a Super Admin {'\u2014'} you can do everything across all modules.
              </Text>
            </View>
          ) : (
            <View testID="account-perm-grid">
              {Object.entries(user.permissions || {})
                .filter(([, v]) => v)
                .map(([k]) => (
                  <View key={k} style={styles.permChip}>
                    <Text style={styles.permText}>{k}</Text>
                  </View>
                ))}
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.steelBlue,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
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
    backgroundColor: '#FAFAFA',
  },
  inputDisabled: { backgroundColor: '#F3F4F6', color: Colors.textMuted },
  hint: { fontSize: 11, color: Colors.textMuted, marginTop: 4 },
  btnPrimary: {
    marginTop: 16,
    height: 48,
    backgroundColor: Colors.safetyYellow,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { fontSize: 15, fontWeight: '800', color: Colors.charcoal },
  btnDark: {
    marginTop: 16,
    height: 48,
    backgroundColor: Colors.charcoal,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDarkText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  btnDisabled: { opacity: 0.5 },
  superBanner: {
    backgroundColor: 'rgba(245,197,24,0.15)',
    borderWidth: 1,
    borderColor: Colors.safetyYellow,
    borderRadius: 6,
    padding: 12,
  },
  superBannerText: { fontSize: 13, fontWeight: '600', color: Colors.charcoal },
  permChip: {
    backgroundColor: Colors.borderLight,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  permText: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: Colors.textSecondary },
});
