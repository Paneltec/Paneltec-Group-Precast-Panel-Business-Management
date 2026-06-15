import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { api } from '../../src/lib/api';
import { formatAUD, formatDateTime, relTime } from '../../src/lib/format';
import { Colors, StatusColors } from '../../src/lib/colors';
import KPICard from '../../src/components/KPICard';
import StatusBadge from '../../src/components/StatusBadge';
import LoadingScreen from '../../src/components/LoadingScreen';

export default function DashboardScreen() {
  const { user, hasPerm, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [kpis, setKpis] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const data = await api('/dashboard/kpis');
      setKpis(data);
    } catch {
      setKpis({ recent_quotes: [] });
    }
  };

  useEffect(() => { load(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.steelBlue} />}
      testID="dashboard-page"
    >
      {/* Welcome Card */}
      <View style={styles.welcomeCard} testID="welcome-card">
        <Text style={styles.overline}>Welcome back</Text>
        <Text style={styles.welcomeTitle}>
          G'day, {user?.name?.split(' ')[0] || 'team'}.
        </Text>
        <Text style={styles.welcomeBody}>
          Paneltec Group — customers, quotes, jobs, invoicing and fleet management.
        </Text>
        <View style={styles.ctaRow}>
          <TouchableOpacity
            testID="dash-new-quote-cta"
            style={styles.ctaPrimary}
            onPress={() => router.push('/quotes')}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaPrimaryText}>View Quotes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="dash-calc-cta"
            style={styles.ctaOutline}
            onPress={() => router.push('/(tabs)/calculator')}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaOutlineText}>Calculator</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* KPI Grid */}
      {kpis ? (
        <>
          <Text style={styles.sectionOverline}>OPERATIONS SNAPSHOT</Text>
          <View style={styles.kpiRow}>
            <KPICard label="Customers Active" value={kpis.customers_active ?? 0} note="All time" testID="kpi-customers-active" />
            <KPICard label="Quotes Sent" value={kpis.quotes_sent ?? 0} note="Awaiting decision" testID="kpi-quotes-sent" />
          </View>
          <View style={styles.kpiRow}>
            <KPICard label="Quotes Accepted" value={kpis.quotes_accepted ?? 0} note="All time" testID="kpi-quotes-accepted" />
            <KPICard label="Quoted This Month" value={formatAUD(kpis.quoted_this_month_aud)} note="AUD inc GST" testID="kpi-quoted-this-month" />
          </View>

          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Drafts in progress</Text>
              <Text style={styles.statValue}>{kpis.quotes_draft ?? 0}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Accepted this month</Text>
              <Text style={styles.statValue}>{formatAUD(kpis.accepted_this_month_aud)}</Text>
            </View>
          </View>

          {/* Recent Quotes */}
          <View style={styles.section} testID="recent-quotes">
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>RECENT QUOTES</Text>
              <TouchableOpacity onPress={() => router.push('/quotes')} testID="view-all-quotes">
                <Text style={styles.viewAll}>View all {'\u2192'}</Text>
              </TouchableOpacity>
            </View>
            {(kpis.recent_quotes ?? []).length === 0 ? (
              <Text style={styles.emptyText}>No quotes yet.</Text>
            ) : (
              (kpis.recent_quotes ?? []).map((q: any) => (
                <TouchableOpacity
                  key={q.id}
                  style={styles.quoteRow}
                  onPress={() => router.push(`/quotes/${q.id}`)}
                  testID={`recent-quote-${q.id}`}
                  activeOpacity={0.7}
                >
                  <View style={styles.quoteLeft}>
                    <Text style={styles.quoteNumber}>{q.quote_number}</Text>
                    <Text style={styles.quoteCustomer}>{q.customer_company_name}</Text>
                  </View>
                  <View style={styles.quoteRight}>
                    <StatusBadge status={q.status} />
                    <Text style={styles.quoteTotal}>{formatAUD(q.total)}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </>
      ) : (
        <LoadingScreen message="Loading dashboard..." />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  welcomeCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 20,
    marginBottom: 20,
  },
  overline: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: Colors.steelBlue,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.charcoal,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  welcomeBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginBottom: 16 },
  ctaRow: { flexDirection: 'row', gap: 12 },
  ctaPrimary: {
    backgroundColor: Colors.safetyYellow,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
  },
  ctaPrimaryText: { fontWeight: '800', color: Colors.charcoal, fontSize: 14 },
  ctaOutline: {
    borderWidth: 1,
    borderColor: Colors.charcoal,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
  },
  ctaOutlineText: { fontWeight: '700', color: Colors.charcoal, fontSize: 14 },
  sectionOverline: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: Colors.steelBlue,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  statRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: { fontSize: 13, color: Colors.textSecondary },
  statValue: { fontSize: 14, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: Colors.steelBlue,
    textTransform: 'uppercase',
  },
  viewAll: { fontSize: 11, fontWeight: '700', color: Colors.steelBlue, letterSpacing: 0.5 },
  quoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  quoteLeft: { flex: 1 },
  quoteNumber: { fontSize: 14, fontWeight: '700', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  quoteCustomer: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  quoteRight: { alignItems: 'flex-end', gap: 4 },
  quoteTotal: { fontSize: 14, fontWeight: '700', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingVertical: 16 },
});
