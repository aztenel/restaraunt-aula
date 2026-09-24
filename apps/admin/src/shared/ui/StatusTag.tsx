import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { tx } from '../i18n/tx';
import { statusColor, type StatusDomain } from './statuses';

/** Тег статуса: цвет по словарю, подпись из i18n (statuses.<domain>.<status>), иначе код статуса. */
export function StatusTag({ domain, status }: { domain: StatusDomain; status: string }) {
  const { t } = useTranslation();
  return (
    <Tag color={statusColor(domain, status)} style={{ marginInlineEnd: 0 }}>
      {tx(t, `statuses.${domain}.${status}`, status)}
    </Tag>
  );
}
