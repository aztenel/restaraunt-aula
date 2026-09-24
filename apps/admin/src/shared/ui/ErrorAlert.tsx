import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { toApiError } from '@aula/api-client';
import { errorMessage } from '../api/errors';

/** Ошибка загрузки данных раздела с кнопкой повтора. */
export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, i18n } = useTranslation();
  const apiError = toApiError(error);
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      message={errorMessage(apiError, i18n.language)}
      description={apiError.requestId ? `requestId: ${apiError.requestId}` : undefined}
      action={
        onRetry ? (
          <Button size="small" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : undefined
      }
    />
  );
}
