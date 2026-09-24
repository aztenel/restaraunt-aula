import { Result } from 'antd';
import { useTranslation } from 'react-i18next';

export function Forbidden() {
  const { t } = useTranslation();
  return <Result status="403" title={t('forbidden.title')} subTitle={t('forbidden.text')} />;
}
