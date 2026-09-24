import { Alert, Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

/** Временный пароль показывается один раз — передайте его сотруднику безопасным способом. */
export function TemporaryPasswordModal({ password, onClose }: { password: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={password !== null} title={t('users.temporaryPasswordTitle')} onOk={onClose} onCancel={onClose} cancelButtonProps={{ style: { display: 'none' } }} okText={t('common.close')}>
      <Alert type="warning" showIcon message={t('users.temporaryPasswordOnce')} style={{ marginBottom: 16 }} />
      <Typography.Paragraph copyable={{ text: password ?? '' }} style={{ fontSize: 20, textAlign: 'center' }}>
        <Typography.Text code>{password}</Typography.Text>
      </Typography.Paragraph>
      <Typography.Text type="secondary">{t('users.temporaryPasswordHint')}</Typography.Text>
    </Modal>
  );
}
