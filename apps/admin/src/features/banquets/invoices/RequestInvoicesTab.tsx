import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Drawer, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canInvoiceIn } from '../request-actions';
import type { BanquetRequestDetail, Invoice } from '../types';
import { invoiceColumns } from './invoice-columns';
import { InvoiceDetails } from './InvoiceDetails';
import { IssueInvoiceModal } from './IssueInvoiceModal';

/** Счета заявки: список, выставление (после согласования сметы), карточка счёта в боковой панели. */
export function RequestInvoicesTab({ request, canInvoice }: { request: BanquetRequestDetail; canInvoice: boolean }) {
  const { t } = useTranslation();
  const [issuing, setIssuing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = request.invoices.find((i) => i.id === openId) ?? null;
  const invoiceable = canInvoiceIn(request.status);

  return (
    <Card
      size="small"
      title={t('banquets.invoices.title')}
      extra={
        canInvoice && invoiceable ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIssuing(true)}>
            {t('banquets.invoices.issue')}
          </Button>
        ) : null
      }
    >
      {!invoiceable && request.status !== 'cancelled' ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('banquets.invoices.onlyAfterAgree')} />
      ) : null}
      <Table<Invoice>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={request.invoices}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('banquets.invoices.empty') }}
        columns={invoiceColumns<Invoice>(t, { onOpen: (inv) => setOpenId(inv.id) })}
        onRow={(inv) => ({ onClick: () => setOpenId(inv.id), style: { cursor: 'pointer' } })}
      />
      <IssueInvoiceModal open={issuing} request={request} onClose={() => setIssuing(false)} onIssued={(inv) => setOpenId(inv.id)} />
      <Drawer open={opened !== null} onClose={() => setOpenId(null)} width={900} title={opened ? t('banquets.invoices.detail.title', { number: opened.number }) : ''} destroyOnHidden>
        {opened ? <InvoiceDetails invoice={opened} requestNumber={request.number} /> : null}
      </Drawer>
    </Card>
  );
}
