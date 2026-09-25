import { CheckCircleOutlined, CloseCircleOutlined, FireOutlined, SendOutlined, StopOutlined, TrophyOutlined } from '@ant-design/icons';
import { Button, Flex, Popconfirm, type ButtonProps } from 'antd';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, type Money } from '@aula/api-client';
import type { OrderAction, OrderActionKey } from '../order-actions';
import type { CheckoutPaymentMethod, OrderType } from '../types';
import { useTransitionOrder } from '../useOrderMutations';

const ICONS: Record<OrderActionKey, ReactNode> = {
  accept: <CheckCircleOutlined />,
  startCooking: <FireOutlined />,
  markReady: <TrophyOutlined />,
  dispatch: <SendOutlined />,
  complete: <CheckCircleOutlined />,
  reject: <StopOutlined />,
  cancel: <CloseCircleOutlined />,
};

export function actionLabel(t: TFunction, key: OrderActionKey, type: OrderType): string {
  if (key === 'complete' && type === 'delivery') return t('orders.actions.completeDelivery');
  return t(`orders.actions.${key}`);
}

export interface ActionOrderRef {
  id: string;
  type: OrderType;
  paymentMethod: CheckoutPaymentMethod;
  /** Сколько получить с гостя при оплате на месте (итог минус сертификат, считает сервер). */
  amountDue: Money;
}

/**
 * Кнопки действий заказа (набор — от сервера, см. order-actions.ts). Переходы выполняются сразу,
 * «Выполнен» при оплате на месте — с подтверждением и суммой к получению (деньги отмечаются полученными);
 * отказ и отмена открывают диалог с причиной (onReject / onCancel).
 */
export function OrderActionButtons({
  order,
  actions,
  size = 'large',
  block,
  onReject,
  onCancel,
  onDone,
}: {
  order: ActionOrderRef;
  actions: OrderAction[];
  size?: ButtonProps['size'];
  /** Главная кнопка на всю ширину (карточка очереди на планшете). */
  block?: boolean;
  onReject?: () => void;
  onCancel?: () => void;
  onDone?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const transition = useTransitionOrder();
  const pendingFor = transition.isPending ? transition.variables : undefined;

  if (actions.length === 0) return null;

  return (
    <Flex gap={8} wrap>
      {actions.map((action) => {
        const label = actionLabel(t, action.key, order.type);
        const common: ButtonProps = {
          size,
          icon: ICONS[action.key],
          style: action.emphasis === 'primary' && block ? { flex: '1 1 100%', minHeight: size === 'large' ? 52 : undefined, fontWeight: 600 } : undefined,
        };
        if (action.to === null) {
          const handler = action.key === 'reject' ? onReject : onCancel;
          if (!handler) return null;
          return (
            <Button key={action.key} {...common} danger onClick={handler}>
              {label}
            </Button>
          );
        }
        const to = action.to;
        const loading = pendingFor?.id === order.id && pendingFor.to === to;
        const run = () => transition.mutate({ id: order.id, to }, { onSuccess: () => onDone?.() });
        const button = (
          <Button
            key={action.key}
            {...common}
            type={action.emphasis === 'primary' ? 'primary' : 'default'}
            loading={loading}
            disabled={transition.isPending && !loading && pendingFor?.id === order.id}
            onClick={to === 'completed' && order.paymentMethod === 'on_receipt' ? undefined : run}
          >
            {label}
          </Button>
        );
        if (to === 'completed' && order.paymentMethod === 'on_receipt') {
          return (
            <Popconfirm
              key={action.key}
              title={t('orders.completeConfirm.title')}
              description={t('orders.completeConfirm.onReceipt', { amount: formatMoney(order.amountDue, i18n.language) })}
              okText={label}
              cancelText={t('common.cancel')}
              onConfirm={run}
            >
              {button}
            </Popconfirm>
          );
        }
        return button;
      })}
    </Flex>
  );
}
