import { CalendarOutlined, FilePdfOutlined, LockOutlined, SendOutlined, UnlockOutlined } from '@ant-design/icons';
import { Alert, App, Button, DatePicker, Flex, Form, Input, Modal, Select, Tooltip } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { dayjs, DISPLAY_TIMEZONE } from '@/shared/lib/dates';
import { formatLocalDate, useCertificateAbilities } from './abilities';
import { certificateKeys, certificatesApi } from './api';
import {
  availableActions,
  extendIssue,
  optionalReasonIssue,
  requiredReasonIssue,
  toResendBody,
  validateResend,
  type ResendFormValues,
} from './certificate-actions';
import type { Certificate } from './types';

type Dialog = 'block' | 'unblock' | 'extend' | 'resend' | null;

function todayLocal(): string {
  return dayjs().tz(DISPLAY_TIMEZONE).format('YYYY-MM-DD');
}

/** Кнопки действий карточки сертификата: блокировка/разблокировка, продление, переотправка, PDF. */
export function CertificateActions({ certificate }: { certificate: Certificate }) {
  const { t } = useTranslation();
  const abilities = useCertificateAbilities();
  const notifyError = useNotifyError();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const actions = availableActions(certificate.status);

  const openPdf = async () => {
    // Окно открываем сразу (иначе браузер заблокирует всплывающее окно после await).
    const popup = window.open('', '_blank');
    setPdfLoading(true);
    try {
      const link = await certificatesApi.pdfLink(certificate.id);
      if (popup) popup.location.href = link.url;
      else window.location.assign(link.url);
    } catch (error) {
      popup?.close();
      notifyError(error);
    } finally {
      setPdfLoading(false);
    }
  };

  if (!abilities.manage && !(abilities.pdf && certificate.hasPdf)) return null;
  return (
    <>
      <Flex gap={8} wrap>
        {abilities.manage && actions.block ? (
          <Button danger icon={<LockOutlined />} onClick={() => setDialog('block')}>
            {t('certificates.actions.block')}
          </Button>
        ) : null}
        {abilities.manage && actions.unblock ? (
          <Button icon={<UnlockOutlined />} onClick={() => setDialog('unblock')}>
            {t('certificates.actions.unblock')}
          </Button>
        ) : null}
        {abilities.manage && actions.extend ? (
          <Button icon={<CalendarOutlined />} onClick={() => setDialog('extend')}>
            {t('certificates.actions.extend')}
          </Button>
        ) : null}
        {abilities.manage ? (
          <Button icon={<SendOutlined />} onClick={() => setDialog('resend')}>
            {t('certificates.actions.resend')}
          </Button>
        ) : null}
        {abilities.pdf && certificate.hasPdf ? (
          <Tooltip title={t('certificates.actions.pdfHint')}>
            <Button icon={<FilePdfOutlined />} loading={pdfLoading} onClick={() => void openPdf()}>
              {t('certificates.actions.pdf')}
            </Button>
          </Tooltip>
        ) : null}
      </Flex>
      {dialog === 'block' ? <BlockModal certificate={certificate} onClose={() => setDialog(null)} /> : null}
      {dialog === 'unblock' ? <UnblockModal certificate={certificate} onClose={() => setDialog(null)} /> : null}
      {dialog === 'extend' ? <ExtendModal certificate={certificate} onClose={() => setDialog(null)} /> : null}
      {dialog === 'resend' ? <ResendModal certificate={certificate} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function useCertificateMutation<TVariables>(fn: (variables: TVariables) => Promise<unknown>, successMessage: string, onClose: () => void) {
  return useApiMutation(fn, { invalidate: [certificateKeys.all], successMessage, onSuccess: () => onClose() });
}

function BlockModal({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ reason?: string }>();
  const block = useCertificateMutation((reason: string) => certificatesApi.block(certificate.id, reason), t('certificates.actions.blocked'), onClose);
  return (
    <Modal
      open
      title={t('certificates.actions.blockTitle', { code: certificate.maskedCode })}
      okText={t('certificates.actions.block')}
      okButtonProps={{ danger: true, loading: block.isPending }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(({ reason }) => block.mutateAsync((reason ?? '').trim()))
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t('certificates.actions.blockHint')} />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="reason"
          label={t('certificates.actions.reason')}
          rules={[
            {
              validator: async (_: unknown, value: string | undefined) => {
                const issue = requiredReasonIssue(value);
                if (issue) throw new Error(t(`certificates.actions.issues.${issue}`));
              },
            },
          ]}
        >
          <Input.TextArea rows={2} maxLength={500} showCount placeholder={t('certificates.actions.blockPlaceholder')} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function UnblockModal({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ reason?: string }>();
  const unblock = useCertificateMutation(
    (reason: string | null) => certificatesApi.unblock(certificate.id, reason),
    t('certificates.actions.unblocked'),
    onClose,
  );
  return (
    <Modal
      open
      title={t('certificates.actions.unblockTitle', { code: certificate.maskedCode })}
      okText={t('certificates.actions.unblock')}
      okButtonProps={{ loading: unblock.isPending }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(({ reason }) => unblock.mutateAsync(reason?.trim() || null))
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('certificates.actions.unblockHint')} />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="reason"
          label={t('certificates.actions.reasonOptional')}
          rules={[
            {
              validator: async (_: unknown, value: string | undefined) => {
                const issue = optionalReasonIssue(value);
                if (issue) throw new Error(t(`certificates.actions.issues.${issue}`));
              },
            },
          ]}
        >
          <Input.TextArea rows={2} maxLength={500} showCount autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ExtendModal({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ validUntil?: Dayjs | null; reason?: string }>();
  const [today] = useState(todayLocal);
  const extend = useCertificateMutation(
    (input: { validUntil: string; reason: string }) => certificatesApi.extend(certificate.id, input.validUntil, input.reason),
    t('certificates.actions.extended'),
    onClose,
  );
  return (
    <Modal
      open
      title={t('certificates.actions.extendTitle', { code: certificate.maskedCode })}
      okText={t('certificates.actions.extend')}
      okButtonProps={{ loading: extend.isPending }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(({ validUntil, reason }) =>
            extend.mutateAsync({ validUntil: validUntil ? validUntil.format('YYYY-MM-DD') : '', reason: (reason ?? '').trim() }),
          )
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('certificates.actions.extendHint', { date: formatLocalDate(certificate.validUntil) })}
      />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="validUntil"
          label={t('certificates.actions.validUntil')}
          rules={[
            {
              validator: async (_: unknown, value: Dayjs | null | undefined) => {
                const issue = extendIssue(value ? value.format('YYYY-MM-DD') : null, certificate.validUntil, today);
                if (issue) throw new Error(t(`certificates.actions.issues.${issue}`));
              },
            },
          ]}
        >
          <DatePicker
            format="DD.MM.YYYY"
            style={{ width: 220 }}
            disabledDate={(day) => {
              const value = day.format('YYYY-MM-DD');
              return value <= certificate.validUntil || value < today;
            }}
          />
        </Form.Item>
        <Form.Item
          name="reason"
          label={t('certificates.actions.reason')}
          rules={[
            {
              validator: async (_: unknown, value: string | undefined) => {
                const issue = requiredReasonIssue(value);
                if (issue) throw new Error(t(`certificates.actions.issues.${issue}`));
              },
            },
          ]}
        >
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ResendModal({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<ResendFormValues>();
  const resend = useApiMutation((values: ResendFormValues) => certificatesApi.resend(certificate.id, toResendBody(values)), {
    invalidate: [certificateKeys.all],
    onSuccess: () => {
      void message.success(t('certificates.actions.resent'));
      onClose();
    },
  });
  const fieldRule = (field: 'channel' | 'email') => ({
    validator: async () => {
      const issue = validateResend(form.getFieldsValue(true), certificate.deliveryChannel)[field];
      if (issue) throw new Error(t(`certificates.actions.issues.${issue}`));
    },
  });
  return (
    <Modal
      open
      title={t('certificates.actions.resendTitle', { code: certificate.maskedCode })}
      okText={t('certificates.actions.resend')}
      okButtonProps={{ loading: resend.isPending }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(() => resend.mutateAsync(form.getFieldsValue(true)))
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('certificates.actions.resendHint')} />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="channel" label={t('certificates.actions.channel')} rules={[fieldRule('channel')]}>
          <Select<'email' | 'whatsapp'>
            allowClear
            style={{ width: 260 }}
            placeholder={
              certificate.deliveryChannel === 'none'
                ? t('certificates.actions.channel')
                : `${t('certificates.actions.channelDefault')}: ${t(`certificates.deliveryChannel.${certificate.deliveryChannel}`)}`
            }
            options={(['email', 'whatsapp'] as const).map((value) => ({ value, label: t(`certificates.deliveryChannel.${value}`) }))}
          />
        </Form.Item>
        <Form.Item name="email" label={t('certificates.actions.email')} rules={[fieldRule('email')]}>
          <Input type="email" maxLength={254} placeholder={certificate.recipient.email ?? undefined} />
        </Form.Item>
        <Form.Item name="phone" label={t('certificates.actions.phone')}>
          <Input inputMode="tel" maxLength={32} placeholder={certificate.recipient.phone ?? '+7'} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
