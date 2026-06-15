import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/contexts/AuthContext';
import { Colors } from '../src/lib/colors';
import ErrorBanner from '../src/components/ErrorBanner';
import LoadingScreen from '../src/components/LoadingScreen';

export default function LoginScreen() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <LoadingScreen />;
  if (user) return <Redirect href="/(tabs)" />;

  const onSubmit = async () => {
    Keyboard.dismiss();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter email and password');
      return;
    }
    setSubmitting(true);
    const res = await login(email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (res.ok) {
      router.replace('/(tabs)');
    } else {
      setError(res.error || 'Login failed');
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.bg}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <SafeAreaView style={styles.container}>
            <View style={styles.brandBlock}>
              <Text style={styles.brandWhite}>Paneltec</Text>
              <Text style={styles.brandYellow}>Group</Text>
              <Text style={styles.brandSub}>PRECAST PANEL BUSINESS MANAGEMENT</Text>
            </View>

            <View style={styles.card} testID="login-card">
              <Text style={styles.title}>Sign in</Text>
              <Text style={styles.subtitle}>Use your Paneltec account to continue.</Text>

              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                testID="login-email-input"
                style={styles.input}
                placeholder="you@paneltec.com.au"
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
              />

              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput
                testID="login-password-input"
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={onSubmit}
              />

              {error ? <ErrorBanner message={error} testID="login-error" /> : null}

              <TouchableOpacity
                testID="login-submit-button"
                style={[styles.btn, submitting && styles.btnDisabled]}
                onPress={onSubmit}
                disabled={submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.charcoal} size="small" />
                ) : (
                  <Text style={styles.btnText}>Sign in</Text>
                )}
              </TouchableOpacity>

              <View style={styles.footer}>
                <Text style={styles.footerText}>Authorised personnel only. JWT-secured session.</Text>
              </View>
            </View>

            <Text style={styles.copyright}>{'\u00A9'} PANELTEC GROUP</Text>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bg: { flex: 1, backgroundColor: Colors.charcoal },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandBlock: { alignItems: 'center', marginBottom: 32 },
  brandWhite: { fontSize: 36, fontWeight: '900', color: '#FFFFFF', letterSpacing: -1 },
  brandYellow: { fontSize: 36, fontWeight: '900', color: Colors.safetyYellow, letterSpacing: -1 },
  brandSub: {
    marginTop: 8,
    fontSize: 10,
    letterSpacing: 3,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.charcoal, marginBottom: 4 },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 20 },
  fieldLabel: {
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
    backgroundColor: '#FAFAFA',
  },
  btn: {
    marginTop: 20,
    height: 48,
    backgroundColor: Colors.safetyYellow,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 15, fontWeight: '800', color: Colors.charcoal },
  footer: { marginTop: 20, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 16 },
  footerText: { fontSize: 11, color: Colors.textMuted },
  copyright: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 9,
    letterSpacing: 2.5,
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '600',
  },
});
