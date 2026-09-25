import { FireOutlined } from '@ant-design/icons';
import { Badge, Button, Empty, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useStoredState } from '@/shared/lib/storage';
import { StatusTag } from '@/shared/ui/StatusTag';
import { PIPELINE_COLUMNS, type BanquetRequestSummary, type PipelineColumn } from '../types';
import { breachedCount, columnOf } from './pipeline-utils';
import { RequestCard } from './RequestCard';

/** Канбан воронки: колонки по статусам (новая → проведено), отменённые — свёрнутой колонкой справа. */
export function PipelineBoard({
  columns,
  now,
  highlighted,
  onOpen,
}: {
  columns: readonly PipelineColumn[];
  now: number;
  highlighted: ReadonlySet<string>;
  onOpen: (request: BanquetRequestSummary) => void;
}) {
  const { t } = useTranslation();
  const [showCancelled, setShowCancelled] = useStoredState('aula_admin_banquets_cancelled', false);
  const cancelled = columnOf(columns, 'cancelled');

  const renderItems = (column: PipelineColumn) => (
    <>
      {column.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('banquets.pipeline.empty')} /> : null}
      {column.items.map((item) => (
        <RequestCard key={item.id} request={item} now={now} fresh={highlighted.has(item.id)} onOpen={onOpen} />
      ))}
      {column.count > column.items.length ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
          {t('banquets.pipeline.shownOf', { shown: column.items.length, count: column.count })}
        </Typography.Text>
      ) : null}
    </>
  );

  return (
    <div className="aula-bq-board">
      {PIPELINE_COLUMNS.map((status) => {
        const column = columnOf(columns, status);
        const breached = status === 'new' ? breachedCount(column) : 0;
        return (
          <section key={status} className={`aula-bq-column${status === 'new' ? ' aula-bq-column--new' : ''}`} aria-label={status}>
            <div className="aula-bq-column-header">
              <StatusTag domain="banquet" status={status} />
              <span>
                {breached > 0 ? (
                  <Tooltip title={t('banquets.pipeline.breachedInColumn', { count: breached })}>
                    <Tag color="red" icon={<FireOutlined />}>
                      {breached}
                    </Tag>
                  </Tooltip>
                ) : null}
                <Badge count={column.count} showZero color={status === 'new' && column.count > 0 ? '#b5452c' : '#a08b76'} overflowCount={999} />
              </span>
            </div>
            {renderItems(column)}
          </section>
        );
      })}
      {showCancelled ? (
        <section className="aula-bq-column aula-bq-column--cancelled" style={{ width: 260 }} aria-label="cancelled">
          <div className="aula-bq-column-header">
            <StatusTag domain="banquet" status="cancelled" />
            <Button size="small" type="link" onClick={() => setShowCancelled(false)}>
              {t('banquets.pipeline.hideCancelled')}
            </Button>
          </div>
          {renderItems(cancelled)}
        </section>
      ) : (
        <Tooltip title={t('banquets.pipeline.showCancelled', { count: cancelled.count })} placement="left">
          <section
            className="aula-bq-column aula-bq-column--cancelled aula-bq-column--collapsed"
            onClick={() => setShowCancelled(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setShowCancelled(true);
            }}
            aria-label={t('banquets.pipeline.showCancelled', { count: cancelled.count })}
          >
            <Badge count={cancelled.count} showZero color="#a08b76" overflowCount={999} />
            <span className="aula-bq-vertical">{t('banquets.pipeline.cancelled')}</span>
          </section>
        </Tooltip>
      )}
    </div>
  );
}
