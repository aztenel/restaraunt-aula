import { Card, Flex, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Brand } from '@/app/layout/Brand';

/** Карточка страниц входа/смены пароля на фирменном фоне. */
export function AuthCard({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: '100dvh', padding: 16, background: 'linear-gradient(160deg, #2a1a10 0%, #57351e 55%, #8a5a36 100%)' }}
    >
      <Card style={{ width: '100%', maxWidth: 420 }} styles={{ body: { padding: 28 } }}>
        <div style={{ background: '#2a1a10', borderRadius: 10, marginBottom: 20, width: 'fit-content' }}>
          <Brand collapsed={false} />
        </div>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {title}
        </Typography.Title>
        {children}
        {extra}
      </Card>
    </Flex>
  );
}
