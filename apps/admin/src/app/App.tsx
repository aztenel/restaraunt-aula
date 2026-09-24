import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import kkKZ from 'antd/locale/kk_KZ';
import ruRU from 'antd/locale/ru_RU';
import { useState, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { RouterProvider } from 'react-router';
import { AuthProvider } from '@/shared/auth/AuthProvider';
import { BranchProvider } from '@/shared/branch/BranchProvider';
import { i18n } from '@/shared/i18n';
import { createQueryClient } from './query-client';
import { createRouter } from './router';
import { theme } from './theme';

/** Локаль Ant Design (календари, пагинация, пустые состояния) — по языку интерфейса. */
function AntdProvider({ children }: { children: ReactNode }) {
  const { i18n: instance } = useTranslation();
  return (
    <ConfigProvider locale={instance.language === 'kk' ? kkKZ : ruRU} theme={theme}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createRouter);
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AntdProvider>
          <AuthProvider>
            <BranchProvider>
              <RouterProvider router={router} />
            </BranchProvider>
          </AuthProvider>
        </AntdProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
