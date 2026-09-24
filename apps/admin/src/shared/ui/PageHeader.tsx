import { Flex, Typography } from 'antd';
import type { ReactNode } from 'react';

/** Заголовок страницы раздела с действиями справа. */
export function PageHeader({ title, subtitle, extra }: { title: ReactNode; subtitle?: ReactNode; extra?: ReactNode }) {
  return (
    <Flex justify="space-between" align="flex-start" gap={16} wrap style={{ marginBottom: 16 }}>
      <div style={{ minWidth: 0 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {subtitle ? (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            {subtitle}
          </Typography.Text>
        ) : null}
      </div>
      {extra ? (
        <Flex gap={8} wrap>
          {extra}
        </Flex>
      ) : null}
    </Flex>
  );
}
