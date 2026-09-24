import { App } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toApiError } from '@aula/api-client';
import { errorFieldMessages, errorMessage } from './errors';

/** Показать ошибку API уведомлением: текст по коду ошибки, поля валидации, requestId для поддержки. */
export function useNotifyError() {
  const { notification } = App.useApp();
  const { t, i18n } = useTranslation();
  return useCallback(
    (error: unknown, title?: string) => {
      const apiError = toApiError(error);
      const fields = errorFieldMessages(apiError);
      notification.error({
        message: title ?? t('common.errorTitle'),
        description: (
          <div>
            <div>{errorMessage(apiError, i18n.language)}</div>
            {fields.length > 0 ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {fields.slice(0, 6).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {apiError.requestId ? (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>requestId: {apiError.requestId}</div>
            ) : null}
          </div>
        ),
      });
    },
    [notification, t, i18n.language],
  );
}
