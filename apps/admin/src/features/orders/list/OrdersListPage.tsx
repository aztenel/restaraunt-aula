import { Button, Flex, Input, Select, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { DateRangeFilter, type DateRangeValue } from '@/shared/ui/DateRangeFilter';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { StatusTag } from '@/shared/ui/StatusTag';
import { ordersApi, ordersKeys } from '../api';
import { ChannelTag, OrderTypeTag, PaymentTag } from '../common/OrderTags';
import { OrderDrawer } from '../detail/OrderDrawer';
import { ORDER_STATUSES, ORDER_TYPES, type AdminOrderListItem, type OrderStatus, type OrderType, type OrdersListQuery } from '../types';

interface Filters {
  q: string;
  statuses: OrderStatus[];
  type: OrderType | undefined;
  range: DateRangeValue;
}

const EMPTY: Filters = { q: '', statuses: [], type: undefined, range: null };

/**
 * Все заказы с фильтрами: филиал — из шапки («Все филиалы» у глобальных ролей), статусы, тип,
 * период оформления, поиск по номеру или телефону. Строка открывает карточку заказа.
 */
export function OrdersListPage() {
  const { t } = useTranslation();
  const { selectedBranchId, branchName } = useBranch();
  const [params, setParams] = useSearchParams();
  const openOrderId = params.get('order');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  const query: OrdersListQuery = useMemo(
    () => ({
      branchId: selectedBranchId ?? undefined,
      status: filters.statuses,
      type: filters.type,
      dateFrom: filters.range?.[0].format('YYYY-MM-DD'),
      dateTo: filters.range?.[1].format('YYYY-MM-DD'),
      q: filters.q || undefined,
      page,
      perPage,
    }),
    [selectedBranchId, filters, page, perPage],
  );
  const list = useApiQuery(ordersKeys.list(query), () => ordersApi.list(query), { keepPrevious: true });

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const setOrder = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('order', id);
    else next.delete('order');
    setParams(next);
  };

  return (
    <>
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Input.Search allowClear placeholder={t('orders.list.search')} style={{ width: 260 }} onSearch={(value) => update({ q: value.trim() })} />
        <Select<OrderStatus[]>
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder={t('orders.list.statuses')}
          style={{ minWidth: 220, maxWidth: 420 }}
          value={filters.statuses}
          onChange={(statuses) => update({ statuses })}
          options={ORDER_STATUSES.filter((s) => s !== 'draft').map((s) => ({ value: s, label: t(`statuses.order.${s}`) }))}
        />
        <Select<OrderType | 'all'>
          style={{ width: 170 }}
          value={filters.type ?? 'all'}
          onChange={(type) => update({ type: type === 'all' ? undefined : type })}
          options={[{ value: 'all', label: t('orders.list.allTypes') }, ...ORDER_TYPES.map((type) => ({ value: type, label: t(`orders.type.${type}`) }))]}
        />
        <DateRangeFilter value={filters.range} onChange={(range) => update({ range })} />
        <Button
          onClick={() => {
            setFilters(EMPTY);
            setPage(1);
          }}
        >
          {t('common.reset')}
        </Button>
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <PaginatedTable<AdminOrderListItem>
        rowKey="id"
        data={list.data}
        loading={list.isLoading || list.isPlaceholderData}
        page={page}
        perPage={perPage}
        onPageChange={(p, pp) => {
          setPage(p);
          setPerPage(pp);
        }}
        onRow={(order) => ({ onClick: () => setOrder(order.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: t('orders.list.number'),
            key: 'number',
            render: (_, order) => (
              <div>
                <Typography.Link strong onClick={() => setOrder(order.id)}>
                  {order.number}
                </Typography.Link>
                <div>
                  <Space size={4} wrap>
                    <OrderTypeTag type={order.type} />
                    <ChannelTag channel={order.channel} />
                  </Space>
                </div>
              </div>
            ),
          },
          { title: t('orders.list.placedAt'), key: 'placedAt', render: (_, order) => formatDateTime(order.placedAt) },
          ...(selectedBranchId ? [] : [{ title: t('orders.list.branch'), key: 'branch', render: (_: unknown, order: AdminOrderListItem) => branchName(order.branchId) }]),
          {
            title: t('orders.list.customer'),
            key: 'customer',
            render: (_, order) => (
              <div>
                <div>{order.customer.name ?? '—'}</div>
                <Typography.Text type="secondary">{order.customer.phone}</Typography.Text>
              </div>
            ),
          },
          {
            title: t('orders.list.scheduled'),
            key: 'scheduled',
            render: (_, order) => (order.scheduledFor ? <Tag color="orange">{formatDateTime(order.scheduledFor)}</Tag> : <Typography.Text type="secondary">{t('orders.list.asap')}</Typography.Text>),
          },
          { title: t('orders.list.total'), key: 'total', align: 'right', render: (_, order) => <MoneyText value={order.total} strong /> },
          {
            title: t('orders.list.payment'),
            key: 'payment',
            render: (_, order) => (
              <Space direction="vertical" size={2}>
                <PaymentTag method={order.paymentMethod} status={order.status} />
                {order.promoCode ? <Tag>{order.promoCode}</Tag> : null}
              </Space>
            ),
          },
          { title: t('orders.list.status'), key: 'status', render: (_, order) => <StatusTag domain="order" status={order.status} /> },
        ]}
      />
      <OrderDrawer orderId={openOrderId} onClose={() => setOrder(null)} />
    </>
  );
}
