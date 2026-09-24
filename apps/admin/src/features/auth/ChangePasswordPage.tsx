import { Alert, App, Button, Form, Input, Space } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toApiError } from '@aula/api-client';
import { errorMessage, messageForCode } from '@/shared/api/errors';
import { useAuth } from '@/shared/auth/AuthProvider';
import { AuthCard } from './AuthCard';
import { passwordStrengthIssues } from './password-policy';

interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** Смена пароля: обязательна после входа по временному паролю (mustChangePassword). */
export function ChangePasswordPage() {
  const { t, i18n } = useTranslation();
  const { changePassword, mustChangePassword, logout } = useAuth();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: ChangePasswordForm) => {
    setSubmitting(true);
    setError(null);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      void message.success(t('auth.passwordChanged'));
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(toApiError(err), i18n.language));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title={t('auth.changePasswordTitle')}
      extra={
        <Space style={{ marginTop: 16 }}>
          {mustChangePassword ? (
            <Button type="link" onClick={() => void logout().then(() => navigate('/login', { replace: true }))}>
              {t('auth.signOut')}
            </Button>
          ) : (
            <Button type="link" onClick={() => navigate(-1)}>
              {t('common.back')}
            </Button>
          )}
        </Space>
      }
    >
      {mustChangePassword ? <Alert type="warning" showIcon message={t('auth.changePasswordRequired')} style={{ marginBottom: 16 }} /> : null}
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} role="alert" /> : null}
      <Form<ChangePasswordForm> layout="vertical" requiredMark={false} onFinish={onFinish} disabled={submitting}>
        <Form.Item name="currentPassword" label={t('auth.currentPassword')} rules={[{ required: true, message: t('common.required') }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label={t('auth.newPassword')}
          extra={t('auth.passwordRules')}
          rules={[
            { required: true, message: t('common.required') },
            {
              validator: async (_, value: string | undefined) => {
                const issues = passwordStrengthIssues(value ?? '');
                if (issues.length === 0) return;
                throw new Error(messageForCode(`password.${issues[0]}`, i18n.language));
              },
            },
          ]}
          hasFeedback
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label={t('auth.confirmPassword')}
          dependencies={['newPassword']}
          rules={[
            { required: true, message: t('common.required') },
            ({ getFieldValue }) => ({
              validator: async (_, value: string | undefined) => {
                if (!value || value === getFieldValue('newPassword')) return;
                throw new Error(t('auth.passwordsMismatch'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting}>
          {t('auth.changePassword')}
        </Button>
      </Form>
    </AuthCard>
  );
}
