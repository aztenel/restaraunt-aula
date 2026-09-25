import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation, type ApiMutationOptions } from '@/shared/api/hooks';
import { banquetsKeys } from '../api';
import type { BanquetRequestDetail } from '../types';

/**
 * Мутация заявки, возвращающая её карточку: карточка сразу кладётся в кэш, воронка/списки/счета
 * (ключи 'banquets') перезапрашиваются.
 */
export function useRequestMutation<TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<BanquetRequestDetail>,
  options: ApiMutationOptions<BanquetRequestDetail, TVariables> = {},
) {
  const queryClient = useQueryClient();
  const { onSuccess, ...rest } = options;
  return useApiMutation<BanquetRequestDetail, TVariables>(mutationFn, {
    ...rest,
    onSuccess: async (detail, variables, context, mutation) => {
      queryClient.setQueryData(banquetsKeys.detail(detail.id), detail);
      await queryClient.invalidateQueries({ queryKey: banquetsKeys.all, refetchType: 'active' });
      await onSuccess?.(detail, variables, context, mutation);
    },
  });
}

/** Перезапросить всё по банкетам (после мутаций, которые не возвращают карточку). */
export function useInvalidateBanquets() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: banquetsKeys.all });
}
