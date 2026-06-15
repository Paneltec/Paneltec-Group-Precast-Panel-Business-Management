import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/contexts/AuthContext';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="quotes/[id]" options={{ headerShown: true, title: 'Quote Detail', headerStyle: { backgroundColor: '#1F2A33' }, headerTintColor: '#F5C518', headerTitleStyle: { fontWeight: '700' } }} />
        <Stack.Screen name="jobs/[id]" options={{ headerShown: true, title: 'Job Detail', headerStyle: { backgroundColor: '#1F2A33' }, headerTintColor: '#F5C518', headerTitleStyle: { fontWeight: '700' } }} />
        <Stack.Screen name="customers/index" options={{ headerShown: true, title: 'Customers', headerStyle: { backgroundColor: '#1F2A33' }, headerTintColor: '#F5C518', headerTitleStyle: { fontWeight: '700' } }} />
        <Stack.Screen name="customers/[id]" options={{ headerShown: true, title: 'Customer Detail', headerStyle: { backgroundColor: '#1F2A33' }, headerTintColor: '#F5C518', headerTitleStyle: { fontWeight: '700' } }} />
        <Stack.Screen name="invoices/index" options={{ headerShown: true, title: 'Invoices', headerStyle: { backgroundColor: '#1F2A33' }, headerTintColor: '#F5C518', headerTitleStyle: { fontWeight: '700' } }} />
        <Stack.Screen name="invoices/[id]" options={{ headerShown: true, title: 'Invoice Detail', headerStyle: { backgroundColor: '#1F2A33' }, headerTintColor: '#F5C518', headerTitleStyle: { fontWeight: '700' } }} />
        <Stack.Screen name="account" options={{ headerShown: true, title: 'My Account', headerStyle: { backgroundColor: '#1F2A33' }, headerTintColor: '#F5C518', headerTitleStyle: { fontWeight: '700' } }} />
      </Stack>
    </AuthProvider>
  );
}
