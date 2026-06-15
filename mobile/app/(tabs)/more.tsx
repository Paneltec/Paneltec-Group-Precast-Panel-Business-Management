import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { Colors } from '../../src/lib/colors';

type MenuItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  route: string;
  perm?: string;
  testID: string;
};

const MENU_ITEMS: MenuItem[] = [
  { icon: 'people', label: 'Customers', route: '/customers', perm: 'customers.view', testID: 'nav-customers' },
  { icon: 'receipt', label: 'Invoices', route: '/invoices', perm: 'invoices.view', testID: 'nav-invoices' },
  { icon: 'person-circle', label: 'My Account', route: '/account', testID: 'nav-account' },
];

export default function MoreScreen() {
  const router = useRouter();
  const { user, hasPerm, logout } = useAuth();

  const visibleItems = MENU_ITEMS.filter((i) => !i.perm || hasPerm(i.perm));

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="more-page">
      {/* User Card */}
      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0)?.toUpperCase() || 'U'}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userRole}>
            {user?.is_super_admin ? 'Super Admin' : user?.role_label || 'Staff'}
          </Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.menuSection}>
        {visibleItems.map((item) => (
          <TouchableOpacity
            key={item.testID}
            style={styles.menuItem}
            onPress={() => router.push(item.route as any)}
            testID={item.testID}
            activeOpacity={0.7}
          >
            <View style={styles.menuLeft}>
              <Ionicons name={item.icon} size={22} color={Colors.steelBlue} />
              <Text style={styles.menuLabel}>{item.label}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={handleLogout}
        testID="logout-btn"
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={20} color="#DC2626" />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Paneltec Group v1.0 {'\u00B7'} Phase 7</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  userCard: {
    backgroundColor: Colors.charcoal,
    borderRadius: 10,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.safetyYellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 22, fontWeight: '800', color: Colors.charcoal },
  userInfo: { marginLeft: 16, flex: 1 },
  userName: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  userRole: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.safetyYellow,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  userEmail: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  menuSection: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    minHeight: 52,
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  menuLabel: { fontSize: 15, fontWeight: '600', color: Colors.charcoal },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
    paddingVertical: 14,
    marginBottom: 20,
  },
  logoutText: { fontSize: 15, fontWeight: '700', color: '#DC2626' },
  version: {
    textAlign: 'center',
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
});
