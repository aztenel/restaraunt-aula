/**
 * Хуки TanStack Query поверх клиента API — стандарт для разделов админки.
 *
 *   const orders = useApiQuery(['orders', 'list', params], () => api.raw<Page<Order>>('GET', '/api/v1/admin/orders', { query: params }));
 *   const accept = useApiMutation((id: string) => ordersApi.transition(id, 'accepted'), {
 *     invalidate: [['orders']],
 *     successMessage: t('common.saved'),
 *   });
 *
 * Ошибки типизированы как ApiError; у мутаций ошибка по умолчанию показывается уведомлением
 * (текст по коду ошибки API), успешная — инвалидирует указанные ключи.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { App } from 'antd';
import type { ApiError } from '@aula/api-client';
import { useNotifyError } from './useNotifyError';

export function useApiQuery<TData>(
  queryKey: QueryKey,
  queryFn: () => Promise<TData>,
  options: Omit<UseQueryOptions<TData, ApiError, TData, QueryKey>, 'queryKey' | 'queryFn'> & { keepPrevious?: boolean } = {},
) {
  const { keepPrevious, ...rest } = options;
  return useQuery<TData, ApiError, TData, QueryKey>({
    queryKey,
    queryFn,
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
    ...rest,
  });
}

export interface ApiMutationOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'> {
  /** Ключи запросов, которые нужно обновить после успеха (например [['orders']]). */
  invalidate?: QueryKey[];
  /** Сообщение об успехе (antd message). */
  successMessage?: string;
  /** Заголовок уведомления об ошибке; false — не показывать (обработка в onError). */
  errorTitle?: string | false;
}

export function useApiMutation<TData, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  { invalidate, successMessage, errorTitle, onSuccess, onError, ...options }: ApiMutationOptions<TData, TVariables> = {},
) {
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const { message } = App.useApp();
  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    ...options,
    onSuccess: async (data, variables, context, mutation) => {
      await Promise.all((invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      if (successMessage) void message.success(successMessage);
      await onSuccess?.(data, variables, context, mutation);
    },
    onError: (error, variables, context, mutation) => {
      if (errorTitle !== false) notifyError(error, errorTitle);
      onError?.(error, variables, context, mutation);
    },
  });
}
