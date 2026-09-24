import { ApiOutlined } from '@ant-design/icons';
import { Card, Collapse, Result, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

export interface ExpectedEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  note?: string;
}

/**
 * Заглушка раздела, модуль которого ещё подключается. Для разработчиков — список ожидаемых
 * эндпоинтов (они же продублированы в TODO в файле страницы).
 */
export function SectionPlaceholder({ endpoints, description }: { endpoints: ExpectedEndpoint[]; description?: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <Result
        icon={<ApiOutlined style={{ color: '#a5774f' }} />}
        title={t('placeholder.title')}
        subTitle={description ?? t('placeholder.text')}
      />
      <Collapse
        size="small"
        items={[
          {
            key: 'endpoints',
            label: t('placeholder.endpoints'),
            children: (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {endpoints.map((e) => (
                  <li key={`${e.method} ${e.path}`}>
                    <Typography.Text code>
                      {e.method} {e.path}
                    </Typography.Text>
                    {e.note ? <Typography.Text type="secondary"> — {e.note}</Typography.Text> : null}
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </Card>
  );
}
