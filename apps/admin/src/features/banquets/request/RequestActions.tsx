import { Button, Form, Input, Modal, Space, Typography, App } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { banquetsApi } from '../api';
import { requestActions, type RequestAction } from '../request-actions';
import type { BanquetRequestDetail } from '../types';
import { useRequestMutation } from './useRequestMutation';

/** Кнопки воронки по allowedTransitions от сервера; подтверждение и отмена с причиной. */
export function RequestActions({ request, canManage }: { request: BanquetRequestDetail; canManage: boolean }) {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const transition = useRequestMutation(({ to, reason: why }: { to: RequestAction['to']; reason?: string }) => banquetsApi.transition(request.id, to, why), {
    successMessage: t('banquets.actions.done'),
  });
  const actions = requestActions(request, canManage);
  if (actions.length === 0) return null;

  const run = (action: RequestAction) => {
    if (action.needsReason) {
      setReason('');
      setReasonError(false);
      setCancelOpen(true);
      return;
    }
    if (!action.confirm) {
      transition.mutate({ to: action.to });
      return;
    }
    const key = action.key as Exclude<RequestAction['key'], 'take' | 'cancel'>;
    modal.confirm({
      title: t(`banquets.actions.confirm.${key}`),
      content: t(`banquets.actions.confirmText.${key}`),
      okText: t(`banquets.actions.${key}`),
      cancelText: t('common.cancel'),
      onOk: () => transition.mutateAsync({ to: action.to }).catch(() => undefined),
    });
  };

  return (
    <>
      <Space wrap>
        {actions.map((action) => (
          <Button
            key={action.key}
            type={action.emphasis === 'primary' ? 'primary' : 'default'}
            danger={action.emphasis === 'danger'}
            loading={transition.isPending && transition.variables?.to === action.to}
            onClick={() => run(action)}
          >
            {t(`banquets.actions.${action.key}`)}
          </Button>
        ))}
      </Space>
      <Modal
        open={cancelOpen}
        title={t('banquets.actions.cancelTitle', { number: request.number })}
        okText={t('banquets.actions.cancel')}
        okButtonProps={{ danger: true, loading: transition.isPending }}
        cancelText={t('common.cancel')}
        onCancel={() => setCancelOpen(false)}
        onOk={async () => {
          if (!reason.trim()) {
            setReasonError(true);
            return;
          }
          try {
            await transition.mutateAsync({ to: 'cancelled', reason });
            setCancelOpen(false);
          } catch {
            // Ошибка показана уведомлением.
          }
        }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">{t('banquets.actions.cancelHint')}</Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item
            label={t('banquets.actions.cancelReason')}
            required
            validateStatus={reasonError ? 'error' : undefined}
            help={reasonError ? t('banquets.actions.cancelReasonRequired') : undefined}
          >
            <Input.TextArea
              rows={3}
              maxLength={1000}
              showCount
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (e.target.value.trim()) setReasonError(false);
              }}
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
