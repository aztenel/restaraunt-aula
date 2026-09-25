import { CalendarOutlined, TeamOutlined, UserOutlined, WalletOutlined } from '@ant-design/icons';
import { Card, Space, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { MoneyText } from '@/shared/ui/MoneyText';
import { formatEventDate } from '../common/format';
import { EventTypeLabel, PlaceTag, SlaTimer } from '../common/ui';
import { slaCountdown } from '../sla';
import type { BanquetRequestSummary } from '../types';

/** Карточка заявки на доске воронки: дата, гости, бюджет, менеджер, таймер SLA, филиал или выезд. */
export function RequestCard({
  request,
  now,
  fresh,
  onOpen,
}: {
  request: BanquetRequestSummary;
  now: number;
  fresh: boolean;
  onOpen: (request: BanquetRequestSummary) => void;
}) {
  const { t } = useTranslation();
  const countdown = slaCountdown(request, now);
  const className = [
    'aula-bq-card',
    countdown?.state === 'breached' ? 'aula-bq-card--breached' : '',
    countdown?.state === 'warning' ? 'aula-bq-card--warning' : '',
    fresh ? 'aula-bq-card--fresh' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Card
      size="small"
      hoverable
      className={className}
      onClick={() => onOpen(request)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(request);
      }}
      aria-label={`${request.number} ${request.contact.name}`}
    >
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <div className="aula-bq-card-line">
          <Typography.Text strong style={{ fontSize: 13 }}>
            {request.number}
          </Typography.Text>
          <SlaTimer subject={request} now={now} />
        </div>
        <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
          {request.contact.name} · <span className="aula-bq-muted">{request.contact.phone}</span>
        </Typography.Text>
        <div className="aula-bq-card-line">
          <span>
            <CalendarOutlined /> {formatEventDate(request.eventDate, request.eventTime)}
          </span>
        </div>
        <div className="aula-bq-card-line">
          <span>
            <TeamOutlined /> {request.guests}
          </span>
          {request.budget ? (
            <Tooltip title={t('banquets.common.budget')}>
              <span>
                <WalletOutlined /> <MoneyText value={request.budget} />
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div className="aula-bq-card-line">
          <PlaceTag isOffsite={request.isOffsite} branchName={request.branchName} offsiteAddress={request.offsiteAddress} />
          <span className="aula-bq-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <EventTypeLabel type={request.eventType} />
          </span>
        </div>
        <div className="aula-bq-card-line">
          <span className="aula-bq-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <UserOutlined /> {request.managerName}
          </span>
          {request.quoteTotal ? (
            <Tooltip title={t('banquets.quote.version', { version: request.quoteVersion ?? '' })}>
              <span style={{ fontSize: 12 }}>
                v{request.quoteVersion} · <MoneyText value={request.quoteTotal} />
              </span>
            </Tooltip>
          ) : null}
        </div>
      </Space>
    </Card>
  );
}
