import { HomeOutlined } from '@ant-design/icons';
import { Button, Card, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { banquetsApi } from '../api';
import { formatInterval } from '../common/format';
import { isOpenStatus } from '../request-actions';
import type { BanquetRequestDetail } from '../types';
import { useRequestMutation } from './useRequestMutation';
import { VenueHoldModal } from './VenueHoldModal';

/** Зал под банкет: текущая занятость, выбор/перенос и освобождение. */
export function VenueHoldCard({ request, canManage }: { request: BanquetRequestDetail; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const release = useRequestMutation(() => banquetsApi.releaseVenue(request.id), { errorTitle: false });
  const editable = canManage && isOpenStatus(request.status);
  const venue = request.venue;

  let body;
  if (request.isOffsite) body = <Typography.Text type="secondary">{t('banquets.venue.offsiteHint')}</Typography.Text>;
  else if (!request.branchId) body = <Typography.Text type="secondary">{t('banquets.venue.noBranchHint')}</Typography.Text>;
  else if (!venue) body = <Typography.Text type="secondary">{t('banquets.venue.none')}</Typography.Text>;
  else
    body = (
      <Space direction="vertical" size={0}>
        <Typography.Text strong>{venue.venueName ? translate(venue.venueName, i18n.language) : venue.venueId}</Typography.Text>
        <span>{formatInterval(venue.start, venue.end)}</span>
      </Space>
    );

  const canChoose = editable && !request.isOffsite && Boolean(request.branchId);

  return (
    <Card
      size="small"
      title={
        <Space>
          <HomeOutlined />
          {t('banquets.venue.title')}
        </Space>
      }
      extra={
        canChoose ? (
          <Space>
            <Button size="small" type={venue ? 'default' : 'primary'} onClick={() => setOpen(true)}>
              {venue ? t('banquets.venue.change') : t('banquets.venue.choose')}
            </Button>
            {venue ? (
              <ConfirmAction
                title={t('banquets.venue.releaseConfirm')}
                danger
                successMessage={t('banquets.venue.released')}
                onConfirm={() => release.mutateAsync()}
                buttonProps={{ size: 'small' }}
              >
                {t('banquets.venue.release')}
              </ConfirmAction>
            ) : null}
          </Space>
        ) : null
      }
    >
      {body}
      {canChoose ? <VenueHoldModal open={open} request={request} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}
