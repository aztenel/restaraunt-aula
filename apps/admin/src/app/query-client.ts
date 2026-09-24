import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@aula/api-client';
import { authEvents } from '@/shared/auth/events';

function onGlobalError(error: unknown): void {
  if (error instanceof ApiError && error.code === 'auth.password_change_required') {
    authEvents.emitPasswordChangeRequired();
  }
}

/** Повторять только сетевые сбои и 5xx; ошибки 4xx (права, валидация) — сразу показывать. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onGlobalError }),
    mutationCache: new MutationCache({ onError: onGlobalError }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
