import { App, Button, Popconfirm, type ButtonProps } from 'antd';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotifyError } from '../api/useNotifyError';

export interface ConfirmActionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Действие; ошибка показывается уведомлением (текст по коду ошибки API). */
  onConfirm: () => Promise<unknown>;
  successMessage?: string;
  danger?: boolean;
  okText?: string;
  buttonProps?: ButtonProps;
  children: ReactNode;
}

/** Кнопка с подтверждением для необратимых/важных действий (сброс пароля, деактивация, повтор задачи). */
export function ConfirmAction({ title, description, onConfirm, successMessage, danger, okText, buttonProps, children }: ConfirmActionProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const [loading, setLoading] = useState(false);
  return (
    <Popconfirm
      title={title}
      description={description}
      okText={okText ?? t('common.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ danger, loading }}
      onConfirm={async () => {
        setLoading(true);
        try {
          await onConfirm();
          if (successMessage) void message.success(successMessage);
        } catch (error) {
          notifyError(error);
        } finally {
          setLoading(false);
        }
      }}
    >
      <Button danger={danger} loading={loading} {...buttonProps}>
        {children}
      </Button>
    </Popconfirm>
  );
}
