import { WalletOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Divider, Modal, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { MoneyText } from '@/shared/ui/MoneyText';
import { banquetsApi } from '../api';
import { isOpenStatus } from '../request-actions';
import { moneyInput, type BanquetRequestDetail } from '../types';
import { useRequestMutation } from './useRequestMutation';

/** Предоплата (по умолчанию 50% согласованной сметы, редактируется) и баланс по заявке — всё от сервера. */
export function PrepaymentCard({ request, canManage }: { request: BanquetRequestDetail; canManage: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const save = useRequestMutation((value: number | null) => banquetsApi.setPrepayment(request.id, value === null ? null : moneyInput(value)), {
    successMessage: t('banquets.prepayment.saved'),
  });
  const { prepayment, balance } = request;
  const editable = canManage && isOpenStatus(request.status);

  return (
    <Card
      size="small"
      title={
        <Space>
          <WalletOutlined />
          {t('banquets.prepayment.title')}
        </Space>
      }
      extra={
        editable ? (
          <Button
            size="small"
            onClick={() => {
              setAmount(prepayment.required?.amount ?? null);
              setEditing(true);
            }}
          >
            {t('banquets.prepayment.edit')}
          </Button>
        ) : null
      }
    >
      <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 200 }}>
        <Descriptions.Item label={t('banquets.prepayment.required')}>
          {prepayment.required ? (
            <Space wrap size={4}>
              <MoneyText value={prepayment.required} strong />
              {prepayment.isCustom ? <Tag>{t('banquets.prepayment.custom')}</Tag> : null}
            </Space>
          ) : (
            <Typography.Text type="secondary">{t('banquets.prepayment.notYet')}</Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.prepayment.paid')}>
          <MoneyText value={prepayment.paid} />
        </Descriptions.Item>
        {prepayment.remaining ? (
          <Descriptions.Item label={t('banquets.prepayment.remaining')}>
            <MoneyText value={prepayment.remaining} type={prepayment.remaining.amount > 0 ? 'danger' : undefined} />
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label={t('banquets.common.status')}>
          {prepayment.covered ? <Tag color="success">{t('banquets.prepayment.covered')}</Tag> : <Tag>{t('banquets.prepayment.notCovered')}</Tag>}
        </Descriptions.Item>
      </Descriptions>
      <Divider plain orientation="left" style={{ margin: '8px 0' }}>
        {t('banquets.prepayment.balance')}
      </Divider>
      <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 200 }}>
        <Descriptions.Item label={t('banquets.prepayment.quoteTotal')}>
          <MoneyText value={balance.quoteTotal} strong />
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.prepayment.invoiced')}>
          <MoneyText value={balance.invoiced} />
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.prepayment.paidTotal')}>
          <MoneyText value={balance.paid} type="success" />
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.prepayment.balanceRemaining')}>
          <MoneyText value={balance.remaining} strong />
        </Descriptions.Item>
      </Descriptions>
      <Modal
        open={editing}
        title={t('banquets.prepayment.amount')}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={save.isPending}
        onCancel={() => setEditing(false)}
        onOk={async () => {
          if (amount === null) return;
          try {
            await save.mutateAsync(amount);
            setEditing(false);
          } catch {
            // Ошибка показана уведомлением.
          }
        }}
        okButtonProps={{ disabled: amount === null }}
        footer={(origin) => (
          <Space>
            {prepayment.isCustom ? (
              <Button
                loading={save.isPending && save.variables === null}
                onClick={async () => {
                  try {
                    await save.mutateAsync(null);
                    setEditing(false);
                  } catch {
                    // Ошибка показана уведомлением.
                  }
                }}
              >
                {t('banquets.prepayment.reset')}
              </Button>
            ) : null}
            {origin}
          </Space>
        )}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">{t('banquets.prepayment.defaultHint')}</Typography.Paragraph>
        <MoneyInput value={amount} onChange={setAmount} autoFocus />
      </Modal>
    </Card>
  );
}
