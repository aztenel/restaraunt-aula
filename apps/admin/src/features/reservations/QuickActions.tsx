/**
 * Быстрые действия на карточке очереди — в один клик, без открытия карточки брони: подтвердить,
 * «пришли», «не пришли». Кнопки — только из разрешённых сервером переходов строки списка
 * (allowedTransitions приходят в каждой брони) и при праве reservations.manage в филиале брони.
 * «Не пришли» спрашивает подтверждение (оплаченный депозит будет удержан).
 */
import { CheckOutlined, CloseOutlined, LoginOutlined } from '@ant-design/icons';
import { App, Button, Popconfirm, Space } from 'antd';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission } from '@aula/api-client';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useCan } from '@/shared/auth/useCan';
import { reservationsApi } from './api';
import { quickActions, type ReservationActionKey } from './reservation-actions';
import { useApplyDetail } from './ReservationDialogs';
import type { ReservationSummary } from './types';

type QuickKey = Extract<ReservationActionKey, 'confirm' | 'arrived' | 'noShow'>;

const ICONS: Record<QuickKey, ReactNode> = { confirm: <CheckOutlined />, arrived: <LoginOutlined />, noShow: <CloseOutlined /> };

export function QuickActions({ reservation: r }: { reservation: ReservationSummary }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const { can } = useCan();
  const apply = useApplyDetail();
  const [busy, setBusy] = useState<QuickKey | null>(null);
  const actions = quickActions(r, can(Permission.ReservationsManage, r.branchId));
  if (actions.length === 0) return null;

  const run = async (key: QuickKey) => {
    setBusy(key);
    try {
      const next = key === 'confirm' ? await reservationsApi.confirm(r.id) : key === 'arrived' ? await reservationsApi.arrived(r.id) : await reservationsApi.noShow(r.id);
      apply(next);
      void message.success(t(`reservations.actions.done.${key}`));
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(null);
    }
  };

  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <Space size={6} wrap onClick={stop} onKeyDown={(e) => e.stopPropagation()}>
      {actions.map((action) => {
        const key = action.key as QuickKey;
        const button = (
          <Button
            key={key}
            size="small"
            type={action.emphasis === 'primary' ? 'primary' : 'default'}
            icon={ICONS[key]}
            loading={busy === key}
            disabled={busy !== null && busy !== key}
            onClick={key === 'noShow' ? undefined : () => void run(key)}
          >
            {t(`reservations.actions.${key}`)}
          </Button>
        );
        if (key !== 'noShow') return button;
        return (
          <Popconfirm
            key={key}
            title={t('reservations.actions.noShowQuestion')}
            description={r.depositState === 'paid' ? t('reservations.actions.noShowDeposit') : undefined}
            okText={t('reservations.actions.noShow')}
            cancelText={t('common.cancel')}
            onConfirm={() => run(key)}
          >
            {button}
          </Popconfirm>
        );
      })}
    </Space>
  );
}
