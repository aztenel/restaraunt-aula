import { ClockCircleOutlined, CopyOutlined, EnvironmentOutlined, FireOutlined, ShopOutlined } from '@ant-design/icons';
import { App, Button, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate, type Translatable } from '@aula/api-client';
import { tx } from '@/shared/i18n/tx';
import { slaCountdown, type SlaSubject } from '../sla';

/** Текущее время с обновлением (таймеры SLA). Выключено — не тикает. */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

export function EventTypeLabel({ type }: { type: string }) {
  const { t } = useTranslation();
  return <>{tx(t, `banquets.eventTypes.${type}`, type)}</>;
}

/** Филиал проведения или «Выезд» (с адресом во всплывающей подсказке). */
export function PlaceTag({
  isOffsite,
  branchName,
  offsiteAddress,
}: {
  isOffsite: boolean;
  branchName: Translatable | null;
  offsiteAddress?: string | null;
}) {
  const { t, i18n } = useTranslation();
  if (isOffsite) {
    return (
      <Tooltip title={offsiteAddress ?? undefined}>
        <Tag color="orange" icon={<EnvironmentOutlined />} style={{ marginInlineEnd: 0 }}>
          {t('banquets.common.offsite')}
          {branchName ? ` · ${translate(branchName, i18n.language)}` : ''}
        </Tag>
      </Tooltip>
    );
  }
  return (
    <Tag icon={<ShopOutlined />} style={{ marginInlineEnd: 0 }}>
      {branchName ? translate(branchName, i18n.language) : t('banquets.common.notSet')}
    </Tag>
  );
}

const SLA_COLORS = { running: 'blue', warning: 'gold', breached: 'red' } as const;

/**
 * Таймер SLA первого ответа для новой заявки: обратный отсчёт 30 минут, красный при нарушении.
 * showBreachedFlag — для уже обработанной заявки показать отметку «SLA нарушен» (карточка заявки).
 */
export function SlaTimer({ subject, now, showBreachedFlag }: { subject: SlaSubject; now: number; showBreachedFlag?: boolean }) {
  const { t } = useTranslation();
  const countdown = slaCountdown(subject, now);
  if (!countdown) {
    return showBreachedFlag && subject.slaBreached ? (
      <Tag color="red" icon={<FireOutlined />} style={{ marginInlineEnd: 0 }}>
        {t('banquets.sla.breachedTag')}
      </Tag>
    ) : null;
  }
  const breached = countdown.state === 'breached';
  return (
    <Tooltip title={t('banquets.sla.deadline')}>
      <Tag
        color={SLA_COLORS[countdown.state]}
        icon={breached ? <FireOutlined /> : <ClockCircleOutlined />}
        style={{ marginInlineEnd: 0, fontVariantNumeric: 'tabular-nums' }}
        role="timer"
      >
        {breached ? t('banquets.sla.breached', { time: countdown.text }) : t('banquets.sla.left', { time: countdown.text })}
      </Tag>
    </Tooltip>
  );
}

const INVOICE_COLORS: Record<string, string> = { issued: 'gold', partially_paid: 'orange', paid: 'success', cancelled: 'default' };

export function InvoiceStatusTag({ status, overdue }: { status: string; overdue?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <Tag color={INVOICE_COLORS[status] ?? 'default'} style={{ marginInlineEnd: overdue ? 4 : 0 }}>
        {tx(t, `banquets.invoices.statuses.${status}`, status)}
      </Tag>
      {overdue ? (
        <Tag color="red" style={{ marginInlineEnd: 0 }}>
          {t('banquets.invoices.overdue')}
        </Tag>
      ) : null}
    </>
  );
}

const ESF_COLORS: Record<string, string> = {
  not_required: 'default',
  pending: 'processing',
  draft_ready: 'gold',
  sent: 'blue',
  registered: 'success',
  failed: 'error',
};

export function EsfStatusTag({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <Tag color={ESF_COLORS[status] ?? 'default'} style={{ marginInlineEnd: 0 }}>
      {tx(t, `banquets.documents.esf.statuses.${status}`, status)}
    </Tag>
  );
}

const DOCUMENT_COLORS: Record<string, string> = { quote: 'geekblue', contract: 'purple', invoice: 'gold', act: 'green', esf_xml: 'cyan' };

export function DocumentKindTag({ kind }: { kind: string }) {
  const { t } = useTranslation();
  return (
    <Tag color={DOCUMENT_COLORS[kind] ?? 'default'} style={{ marginInlineEnd: 0 }}>
      {tx(t, `banquets.documents.kinds.${kind}`, kind)}
    </Tag>
  );
}

/** Ссылка для клиента: открыть и скопировать. */
export function CopyLink({ url, label }: { url: string; label?: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      void message.success(t('banquets.common.linkCopied'));
    } catch {
      window.prompt(t('banquets.common.copyLink'), url);
    }
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%' }}>
      <Typography.Link href={url} target="_blank" rel="noreferrer" ellipsis style={{ maxWidth: 360 }}>
        {label ?? url}
      </Typography.Link>
      <Tooltip title={t('banquets.common.copyLink')}>
        <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copy()} aria-label={t('banquets.common.copyLink')} />
      </Tooltip>
    </span>
  );
}
