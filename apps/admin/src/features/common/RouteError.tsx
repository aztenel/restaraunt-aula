import { Button, Result } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { reportError } from '@/app/sentry';

/** Ошибка рендера/загрузки раздела (например, не загрузился чанк после обновления). */
export function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation();
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <Result
      status="error"
      title={t('errorPage.title')}
      subTitle={t('errorPage.text')}
      extra={
        <Button type="primary" onClick={() => window.location.reload()}>
          {t('errorPage.reload')}
        </Button>
      }
    />
  );
}
