import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { AuthPayload, Preferences, SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  profile: Record<string, unknown> | null;
  preferences: Preferences | null;
  counts: AuthPayload['counts'];
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setPreferences: (preferences: Preferences) => void;
}

const emptyCounts = { trips: 0, bookings: 0, reservations: 0, saved: 0, passport: 0 };

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  preferences: null,
  counts: emptyCounts,
  loading: true,
  refresh: async () => undefined,
  login: async () => undefined,
  register: async () => undefined,
  logout: async () => undefined,
  setPreferences: () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [preferences, setPreferencesState] = useState<Preferences | null>(null);
  const [counts, setCounts] = useState<AuthPayload['counts']>(emptyCounts);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<AuthPayload>('/auth/me');
      setUser(data.user);
      setProfile(data.profile);
      setPreferencesState(data.preferences);
      setCounts(data.counts ?? emptyCounts);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    await api('/auth/login', { method: 'POST', body: { email, password } });
    await refresh();
  }, [refresh]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    await api('/auth/register', { method: 'POST', body: { name, email, password } });
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    setProfile(null);
    setPreferencesState(null);
    setCounts(emptyCounts);
  }, []);

  const setPreferences = useCallback((next: Preferences) => {
    setPreferencesState(next);
  }, []);

  const value = useMemo(
    () => ({ user, profile, preferences, counts, loading, refresh, login, register, logout, setPreferences }),
    [user, profile, preferences, counts, loading, refresh, login, register, logout, setPreferences],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
