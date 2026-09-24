import { Button, Result } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title={t('notFound.title')}
      subTitle={t('notFound.text')}
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          {t('notFound.home')}
        </Button>
      }
    />
  );
}
