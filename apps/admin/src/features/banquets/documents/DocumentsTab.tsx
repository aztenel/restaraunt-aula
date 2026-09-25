import { DownloadOutlined, FileAddOutlined, RedoOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Descriptions, Empty, Row, Select, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { formatDateTime } from '@/shared/lib/dates';
import { MoneyText } from '@/shared/ui/MoneyText';
import { banquetRefKeys, banquetsApi, openSignedLink } from '../api';
import { formatIsoDate } from '../common/format';
import { DocumentKindTag, EsfStatusTag } from '../common/ui';
import { canIssueActFor, canRetryEsf } from '../request-actions';
import { useInvalidateBanquets } from '../request/useRequestMutation';
import type { BanquetDocument, BanquetRequestDetail } from '../types';

/**
 * Документы заявки: договор по шаблону (номер — один на заявку), акт после проведения, ЭСФ по акту
 * (статус и повтор), список документов со скачиванием по подписанной ссылке.
 */
export function DocumentsTab({ request, canIssue }: { request: BanquetRequestDetail; canIssue: boolean }) {
  const { t } = useTranslation();
  const notifyError = useNotifyError();
  const invalidate = useInvalidateBanquets();
  const templates = useApiQuery(banquetRefKeys.templates, banquetsApi.templates, { enabled: canIssue, staleTime: 5 * 60_000 });
  const [templateId, setTemplateId] = useState<string | null>(null);
  const closed = request.status === 'cancelled';

  useEffect(() => {
    if (templateId || !templates.data) return;
    setTemplateId(templates.data.find((tpl) => tpl.isDefault)?.id ?? templates.data[0]?.id ?? null);
  }, [templates.data, templateId]);

  const contract = useApiMutation(() => banquetsApi.generateContract(request.id, templateId), {
    successMessage: t('banquets.documents.contract.done'),
    onSuccess: () => invalidate(),
  });
  const act = useApiMutation(() => banquetsApi.issueAct(request.id), { successMessage: t('banquets.documents.act.done'), onSuccess: () => invalidate() });
  const esfRetry = useApiMutation((actId: string) => banquetsApi.retryEsf(actId), { successMessage: t('banquets.documents.esf.retried'), onSuccess: () => invalidate() });

  const download = (doc: BanquetDocument) => openSignedLink(() => banquetsApi.documentLink(doc.id)).catch(notifyError);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title={t('banquets.documents.contract.title')} style={{ height: '100%' }}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text strong>
                {request.contractNumber && request.contractDate
                  ? t('banquets.documents.contract.number', { number: request.contractNumber, date: formatIsoDate(request.contractDate) })
                  : t('banquets.documents.contract.none')}
              </Typography.Text>
              <Typography.Text type="secondary">{t('banquets.documents.contract.hint')}</Typography.Text>
              {canIssue && !closed ? (
                templates.data && templates.data.length === 0 ? (
                  <Alert type="warning" showIcon message={t('banquets.documents.contract.noTemplates')} />
                ) : (
                  <Space wrap>
                    <Select
                      value={templateId ?? undefined}
                      onChange={setTemplateId}
                      loading={templates.isLoading}
                      placeholder={t('banquets.documents.contract.template')}
                      style={{ minWidth: 260 }}
                      options={(templates.data ?? []).map((tpl) => ({
                        value: tpl.id,
                        label: tpl.isDefault ? `${tpl.name} (${t('banquets.documents.contract.defaultTemplate')})` : tpl.name,
                      }))}
                    />
                    <Button type="primary" icon={<FileAddOutlined />} loading={contract.isPending} onClick={() => contract.mutate()}>
                      {request.contractNumber ? t('banquets.documents.contract.regenerate') : t('banquets.documents.contract.generate')}
                    </Button>
                  </Space>
                )
              ) : null}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title={t('banquets.documents.act.title')} style={{ height: '100%' }}>
            {request.act ? (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text strong>{t('banquets.documents.act.number', { number: request.act.number, date: formatIsoDate(request.act.actDate) })}</Typography.Text>
                <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 160 }}>
                  <Descriptions.Item label={t('banquets.invoices.buyer')}>
                    {request.act.buyer.name}
                    {request.act.buyer.bin ? ` · ${request.act.buyer.bin}` : ''}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('banquets.invoices.amount')}>
                    <MoneyText value={request.act.amount} strong />
                  </Descriptions.Item>
                  <Descriptions.Item label={t('banquets.invoices.vat')}>
                    <MoneyText value={request.act.vat} />
                  </Descriptions.Item>
                  <Descriptions.Item label={t('banquets.documents.esf.title')}>
                    <Space wrap>
                      <EsfStatusTag status={request.act.esf.status} />
                      {request.act.esf.registrationNumber ? (
                        <Typography.Text copyable>
                          {t('banquets.documents.esf.registrationNumber')}: {request.act.esf.registrationNumber}
                        </Typography.Text>
                      ) : null}
                      {canIssue && canRetryEsf(request.act.esf.status) ? (
                        <Button size="small" icon={<RedoOutlined />} loading={esfRetry.isPending} onClick={() => esfRetry.mutate(request.act!.id)}>
                          {t('banquets.documents.esf.retry')}
                        </Button>
                      ) : null}
                    </Space>
                  </Descriptions.Item>
                </Descriptions>
                {request.act.esf.error ? <Alert type="error" showIcon message={t('banquets.documents.esf.error')} description={request.act.esf.error} /> : null}
                <Typography.Text type="secondary">{t('banquets.documents.esf.hint')}</Typography.Text>
              </Space>
            ) : (
              <Space direction="vertical" size={8}>
                <Typography.Text type="secondary">{t('banquets.documents.act.notYet')}</Typography.Text>
                {canIssue && canIssueActFor(request.status, false) ? (
                  <Button type="primary" icon={<FileAddOutlined />} loading={act.isPending} onClick={() => act.mutate()}>
                    {t('banquets.documents.act.issue')}
                  </Button>
                ) : null}
              </Space>
            )}
          </Card>
        </Col>
      </Row>
      <Card size="small" title={t('banquets.documents.title')}>
        {request.documents.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('banquets.documents.empty')} />
        ) : (
          <Table<BanquetDocument>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={request.documents}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: '', dataIndex: 'kind', render: (kind: string) => <DocumentKindTag kind={kind} /> },
              {
                title: t('banquets.documents.document'),
                dataIndex: 'title',
                render: (title: string, doc) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Link onClick={() => void download(doc)}>{title}</Typography.Link>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {doc.filename}
                    </Typography.Text>
                  </Space>
                ),
              },
              { title: t('banquets.documents.createdBy'), dataIndex: 'createdByName' },
              { title: t('banquets.documents.createdAt'), dataIndex: 'createdAt', render: (v: string) => formatDateTime(v) },
              {
                title: '',
                key: 'download',
                render: (_, doc) => (
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => void download(doc)}>
                    {t('banquets.common.download')}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}
