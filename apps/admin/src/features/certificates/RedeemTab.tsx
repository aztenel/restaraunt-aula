import { CheckCircleFilled, ClearOutlined, SafetyCertificateOutlined, ShopOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Col, Descriptions, Flex, Form, Input, Result, Row, Space, Tag, Typography, type InputRef } from 'antd';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@aula/api-client';
import { useApiMutation } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { StatusTag } from '@/shared/ui/StatusTag';
import { formatLocalDate, useCertificateAbilities } from './abilities';
import { certificateKeys, certificatesApi } from './api';
import {
  amountToDebit,
  formatCodeInput,
  hasAmbiguousChars,
  isCodeComplete,
  REDEEM_COMMENT_MAX,
  redeemBlocker,
  redeemMode,
  toRedeemBody,
  validateRedeem,
  type RedeemErrors,
  type RedeemFormValues,
} from './redeem-form';
import type { CertificateBalance, RedeemBody, RedeemResult } from './types';

interface Checked {
  code: string;
  certificate: CertificateBalance;
}

/**
 * Экран кассира на точке (планшет): код → проверка (маска кода, вид, статус, остаток, срок) → списание.
 * На сумму — частичное списание (не больше остатка), набор — только целиком. Погашение — право
 * certificates.redeem в выбранном филиале; без него доступна только проверка (certificates.view).
 */
export function RedeemTab() {
  const { t, i18n } = useTranslation();
  const { modal } = App.useApp();
  const abilities = useCertificateAbilities();
  const { selectedBranchId, setSelection, branchName } = useBranch();
  const [form] = Form.useForm<RedeemFormValues>();
  const inputRef = useRef<InputRef>(null);
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState<Checked | null>(null);
  const [result, setResult] = useState<RedeemResult | null>(null);
  const branchId = selectedBranchId && abilities.canRedeemIn(selectedBranchId) ? selectedBranchId : null;
  const money = (amount: number) => formatMoney({ amount, currency: 'KZT' }, i18n.language);

  const check = useApiMutation((value: string) => certificatesApi.check(value), {
    errorTitle: false,
    onSuccess: (certificate, value) => {
      setChecked({ code: value, certificate });
      setResult(null);
    },
  });
  const redeem = useApiMutation((body: RedeemBody) => certificatesApi.redeem(body), {
    errorTitle: false,
    invalidate: [certificateKeys.all],
    onSuccess: (response) => {
      setResult(response);
      setChecked((current) => (current ? { ...current, certificate: response.certificate } : current));
    },
  });

  const reset = () => {
    setCode('');
    setChecked(null);
    setResult(null);
    check.reset();
    redeem.reset();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const runCheck = () => {
    if (!isCodeComplete(code) || check.isPending) return;
    redeem.reset();
    check.mutate(formatCodeInput(code));
  };

  const fieldRule = (field: keyof RedeemErrors) => ({
    validator: async () => {
      if (!checked) return;
      const issue = validateRedeem(form.getFieldsValue(true), checked.certificate)[field];
      if (issue) throw new Error(t(`certificates.redeem.issues.${issue}`));
    },
  });

  const submit = async () => {
    if (!checked || !branchId) return;
    await form.validateFields();
    const values = form.getFieldsValue(true);
    const debit = amountToDebit(values, checked.certificate);
    const isSet = redeemMode(checked.certificate.kind) === 'full';
    modal.confirm({
      title: isSet
        ? t('certificates.redeem.confirmSet', { code: checked.certificate.maskedCode })
        : t('certificates.redeem.confirmTitle', { amount: money(debit ?? 0), code: checked.certificate.maskedCode }),
      content: t('certificates.redeem.confirmText', { branch: branchName(branchId) }),
      okText: t('certificates.redeem.confirmOk'),
      cancelText: t('common.cancel'),
      okButtonProps: { size: 'large' },
      cancelButtonProps: { size: 'large' },
      onOk: () => redeem.mutateAsync(toRedeemBody(checked.code, values, checked.certificate, branchId)).catch(() => undefined),
    });
  };

  const certificate = checked?.certificate ?? null;
  const blocker = certificate ? redeemBlocker(certificate) : null;
  const complete = isCodeComplete(code);

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Card title={t('certificates.redeem.title')}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text strong>{t('certificates.redeem.codeLabel')}</Typography.Text>
            <Input
              ref={inputRef}
              size="large"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              aria-label={t('certificates.redeem.codeLabel')}
              placeholder={t('certificates.redeem.codePlaceholder')}
              value={code}
              maxLength={14}
              style={{ fontSize: 28, height: 64, letterSpacing: 3, textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              onChange={(e) => {
                setCode(formatCodeInput(e.target.value));
                setChecked(null);
                setResult(null);
                check.reset();
                redeem.reset();
              }}
              onPressEnter={runCheck}
            />
            <Typography.Text type="secondary">{t('certificates.redeem.codeHint')}</Typography.Text>
            {hasAmbiguousChars(code) ? <Alert type="warning" showIcon message={t('certificates.redeem.ambiguous')} /> : null}
            <Flex gap={8}>
              <Button
                type="primary"
                size="large"
                icon={<SafetyCertificateOutlined />}
                style={{ flex: 1, height: 56, fontSize: 18 }}
                disabled={!complete}
                loading={check.isPending}
                onClick={runCheck}
              >
                {t('certificates.redeem.check')}
              </Button>
              <Button size="large" icon={<ClearOutlined />} style={{ height: 56 }} onClick={reset} aria-label={t('certificates.redeem.clear')}>
                {t('certificates.redeem.clear')}
              </Button>
            </Flex>
            {check.error ? <ErrorAlert error={check.error} /> : null}
          </Space>
        </Card>

        {abilities.redeemSomewhere ? (
          <Card style={{ marginTop: 16 }} title={<Space><ShopOutlined />{t('certificates.redeem.branch')}</Space>}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <BranchSelect
                size="large"
                style={{ width: '100%' }}
                onlyIds={abilities.redeemBranches === 'all' ? undefined : abilities.redeemBranches}
                value={branchId}
                onChange={(id) => id && setSelection(id)}
              />
              <Typography.Text type="secondary">{t('certificates.redeem.branchHint')}</Typography.Text>
            </Space>
          </Card>
        ) : (
          <Alert style={{ marginTop: 16 }} type="info" showIcon message={t('certificates.redeem.noRedeemBranch')} />
        )}
      </Col>

      <Col xs={24} lg={14}>
        {certificate ? (
          <Card
            title={
              <Space wrap>
                <Typography.Text strong style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 18 }}>
                  {certificate.maskedCode}
                </Typography.Text>
                <Tag color={certificate.kind === 'set' ? 'purple' : 'blue'}>{t(`certificates.kind.${certificate.kind}`)}</Tag>
                <StatusTag domain="certificate" status={certificate.status} />
              </Space>
            }
          >
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <Typography.Text type="secondary">{t('certificates.redeem.balance')}</Typography.Text>
                <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(certificate.balance, i18n.language)}
                </div>
              </div>
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: 'nominal', label: t('certificates.redeem.nominal'), children: formatMoney(certificate.nominal, i18n.language) },
                  {
                    key: 'validUntil',
                    label: t('certificates.redeem.validUntil'),
                    children: t('certificates.redeem.validUntilValue', { date: formatLocalDate(certificate.validUntil) }),
                  },
                  ...(certificate.setDescription
                    ? [{ key: 'set', label: t('certificates.redeem.setDescription'), children: certificate.setDescription }]
                    : []),
                ]}
              />

              {result ? (
                <Result
                  status="success"
                  icon={<CheckCircleFilled />}
                  title={t('certificates.redeem.success', { amount: formatMoney(result.transaction.amount, i18n.language) })}
                  subTitle={t('certificates.redeem.successBalance', { amount: formatMoney(result.certificate.balance, i18n.language) })}
                  extra={
                    <Button type="primary" size="large" style={{ height: 56, minWidth: 240 }} onClick={reset}>
                      {t('certificates.redeem.next')}
                    </Button>
                  }
                />
              ) : blocker ? (
                <Alert type="error" showIcon message={t(`certificates.redeem.blocker.${blocker}`)} />
              ) : !branchId ? (
                <Alert type="info" showIcon message={abilities.redeemSomewhere ? t('certificates.redeem.branchHint') : t('certificates.redeem.viewOnly')} />
              ) : (
                <Form<RedeemFormValues> form={form} layout="vertical" requiredMark={false} preserve={false} onFinish={() => void submit()}>
                  {redeemMode(certificate.kind) === 'partial' ? (
                    <Form.Item label={t('certificates.redeem.amount')} required>
                      <Flex gap={8} wrap>
                        <Form.Item name="amount" noStyle rules={[fieldRule('amount')]}>
                          <MoneyInput size="large" max={certificate.balance.amount} style={{ maxWidth: 260, height: 56, fontSize: 22 }} />
                        </Form.Item>
                        <Button
                          size="large"
                          style={{ height: 56 }}
                          onClick={() => {
                            form.setFieldValue('amount', certificate.balance.amount);
                            void form.validateFields(['amount']).catch(() => undefined);
                          }}
                        >
                          {t('certificates.redeem.fullAmount')}
                        </Button>
                      </Flex>
                    </Form.Item>
                  ) : (
                    <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('certificates.redeem.setFull')} />
                  )}
                  <Form.Item name="comment" label={t('certificates.redeem.comment')} rules={[fieldRule('comment')]}>
                    <Input size="large" maxLength={REDEEM_COMMENT_MAX} placeholder={t('certificates.redeem.commentPlaceholder')} />
                  </Form.Item>
                  {redeem.error ? <ErrorAlert error={redeem.error} /> : null}
                  <Button type="primary" danger htmlType="submit" size="large" block style={{ height: 64, fontSize: 20 }} loading={redeem.isPending}>
                    {redeemMode(certificate.kind) === 'full' ? t('certificates.redeem.submitSet') : t('certificates.redeem.submitAmount')}
                  </Button>
                </Form>
              )}
            </Space>
          </Card>
        ) : null}
      </Col>
    </Row>
  );
}

