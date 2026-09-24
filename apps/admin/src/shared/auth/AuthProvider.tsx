/**
 * Контекст сессии: восстановление при старте (refresh-cookie), вход, выход, смена пароля,
 * профиль и права (GET /admin/auth/me).
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Me } from '@aula/api-client';
import { authApi } from '../api/endpoints';
import { authEvents } from './events';
import { session } from './session';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  me: Me | null;
  /** Требуется смена временного пароля (вход по временному паролю или 403 auth.password_change_required). */
  mustChangePassword: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  reloadMe(): Promise<void>;
  markPasswordChangeRequired(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const bootstrapped = useRef(false);

  const loadMe = useCallback(async () => {
    const profile = await authApi.me();
    setMe(profile);
    setMustChangePassword(profile.mustChangePassword);
    setStatus('authenticated');
  }, []);

  // Потеря сессии (refresh не удался) → на страницу входа.
  useEffect(
    () =>
      session.subscribe((_state, reason) => {
        if (reason === 'expired') {
          setStatus('anonymous');
          setMe(null);
          queryClient.clear();
        }
      }),
    [queryClient],
  );

  useEffect(() => authEvents.onPasswordChangeRequired(() => setMustChangePassword(true)), []);

  // Тихое восстановление сессии при открытии админки.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      const ok = await session.refresh();
      if (!ok) {
        setStatus('anonymous');
        return;
      }
      try {
        await loadMe();
      } catch {
        session.clear();
        setStatus('anonymous');
      }
    })();
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login({ email, password });
      session.setSession(result);
      setMustChangePassword(result.mustChangePassword);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Выходим локально в любом случае.
    }
    session.clear();
    queryClient.clear();
    setMe(null);
    setMustChangePassword(false);
    setStatus('anonymous');
  }, [queryClient]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await authApi.changePassword({ currentPassword, newPassword });
      // Сервер отзывает refresh-токены после смены пароля: входим заново новым паролем.
      if (me) {
        const result = await authApi.login({ email: me.email, password: newPassword });
        session.setSession(result);
      }
      await loadMe();
    },
    [loadMe, me],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      mustChangePassword,
      login,
      logout,
      changePassword,
      reloadMe: loadMe,
      markPasswordChangeRequired: () => setMustChangePassword(true),
    }),
    [status, me, mustChangePassword, login, logout, changePassword, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
