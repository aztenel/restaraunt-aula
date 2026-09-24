import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { toApiError } from '@aula/api-client';
import { errorMessage } from '@/shared/api/errors';
import { useAuth } from '@/shared/auth/AuthProvider';
import { PageLoader } from '@/shared/ui/PageLoader';
import { AuthCard } from './AuthCard';

interface LoginForm {
  email: string;
  password: string;
}

/** Только внутренние пути — защита от открытого редиректа через ?next=. */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const { status, login, mustChangePassword } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') return <PageLoader />;
  if (status === 'authenticated') return <Navigate to={mustChangePassword ? '/change-password' : safeNext(params.get('next'))} replace />;

  const onFinish = async (values: LoginForm) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.email.trim(), values.password);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError(errorMessage(toApiError(err), i18n.language));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title={t('auth.loginTitle')}>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} role="alert" /> : null}
      <Form<LoginForm> layout="vertical" requiredMark={false} onFinish={onFinish} disabled={submitting}>
        <Form.Item
          name="email"
          label={t('auth.email')}
          rules={[
            { required: true, message: t('common.required') },
            { type: 'email', message: t('common.invalidEmail') },
          ]}
        >
          <Input prefix={<MailOutlined />} autoComplete="username" inputMode="email" size="large" autoFocus />
        </Form.Item>
        <Form.Item name="password" label={t('auth.password')} rules={[{ required: true, message: t('common.required') }]}>
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
          {t('auth.signIn')}
        </Button>
      </Form>
    </AuthCard>
  );
}
