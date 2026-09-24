import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Permission } from '@aula/api-client';
import { useCan } from '@/shared/auth/useCan';
import { PageHeader } from '@/shared/ui/PageHeader';
import { FailedJobsTab } from './FailedJobsTab';
import { IntegrationLogsTab } from './IntegrationLogsTab';

/** Система: очередь неудач (system.jobs) и журнал интеграций (integrations.manage). */
export function SystemPage() {
  const { t } = useTranslation();
  const { canSomewhere } = useCan();
  const items = [
    ...(canSomewhere(Permission.SystemJobs) ? [{ key: 'jobs', label: t('system.tabs.jobs'), children: <FailedJobsTab /> }] : []),
    ...(canSomewhere(Permission.IntegrationsManage) ? [{ key: 'logs', label: t('system.tabs.logs'), children: <IntegrationLogsTab /> }] : []),
  ];
  return (
    <>
      <PageHeader title={t('nav.system')} subtitle={t('sections.system')} />
      <Tabs items={items} destroyOnHidden />
    </>
  );
}
