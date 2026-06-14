import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, tokenStore, formatApiErrorDetail } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    const token = tokenStore.get();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (e) {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const login = async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      tokenStore.set(data.access_token);
      setUser(data.user);
      return { ok: true, user: data.user };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) { /* ignore */ }
    tokenStore.clear();
    setUser(null);
  };

  const isSuperAdmin = !!user?.is_super_admin;
  // legacy alias kept so existing code doesn't break
  const isAdmin = isSuperAdmin;

  const hasPerm = useCallback((key) => {
    if (!user) return false;
    if (user.is_super_admin) return true;
    if (!key) return true;
    return !!user.permissions?.[key];
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout,
      isAdmin, isSuperAdmin, hasPerm,
      refresh: fetchMe, setUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};

export const usePermission = (key) => {
  const { hasPerm } = useAuth();
  return hasPerm(key);
};
