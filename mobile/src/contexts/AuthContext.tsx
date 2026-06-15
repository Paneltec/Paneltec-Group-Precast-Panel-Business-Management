import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, tokenStore } from '../lib/api';

type User = {
  id: string;
  email: string;
  name: string;
  role?: string;
  role_label?: string;
  is_super_admin?: boolean;
  permissions?: Record<string, boolean>;
  must_change_password?: boolean;
  last_login_at?: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; user?: User }>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  hasPerm: (key?: string) => boolean;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    const token = await tokenStore.get();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api('/auth/me');
      setUser(data);
    } catch (e) {
      await tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (email: string, password: string) => {
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      await tokenStore.set(data.access_token);
      setUser(data.user);
      return { ok: true, user: data.user };
    } catch (e: any) {
      return { ok: false, error: e.message || 'Login failed' };
    }
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (_) {}
    await tokenStore.clear();
    setUser(null);
  };

  const isSuperAdmin = !!user?.is_super_admin;
  const isAdmin = isSuperAdmin;

  const hasPerm = useCallback(
    (key?: string) => {
      if (!user) return false;
      if (user.is_super_admin) return true;
      if (!key) return true;
      return !!user.permissions?.[key];
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, isAdmin, isSuperAdmin, hasPerm, refresh: fetchMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
