// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Translatable } from '@aula/api-client';
import type * as CatalogModule from '@/shared/api/catalog';
import { i18n } from '@/shared/i18n';
import { HtmlBodyEditor } from './HtmlBodyEditor';

const previewPage = vi.fn();

vi.mock('@/shared/api/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogModule>();
  return { ...actual, contentApi: { ...actual.contentApi, previewPage: (...args: unknown[]) => previewPage(...args) } };
});

beforeAll(async () => {
  configure({ asyncUtilTimeout: 5000 });
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  cleanup();
  previewPage.mockReset();
});

function Harness({ initial }: { initial: Translatable }) {
  const [value, setValue] = useState<Translatable>(initial);
  return <HtmlBodyEditor value={value} onChange={setValue} debounceMs={0} />;
}

function wrap(initial: Translatable) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <App>
          <Harness initial={initial} />
        </App>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('предпросмотр страницы до сохранения', { timeout: 30_000 }, () => {
  it('черновик очищает сервер (ничего не сохраняя); если он что-то убрал — предупреждение', async () => {
    previewPage.mockImplementation(async (body: Translatable) => ({
      body: { ru: (body.ru ?? '').replace(/<script>.*<\/script>/, '') },
      changed: /<script>/.test(body.ru ?? ''),
    }));
    wrap({ ru: '<p>Доставка</p>' });
    await waitFor(() => expect(previewPage).toHaveBeenCalledWith({ ru: '<p>Доставка</p>' }));
    const frame = await screen.findByTitle(/Предпросмотр/);
    expect(frame.getAttribute('srcdoc')).toContain('<p>Доставка</p>');
    expect(screen.queryByText(/Сервер удалит или изменит/)).toBeNull();

    fireEvent.change(screen.getByLabelText('HTML (Русский)'), { target: { value: '<p>Оплата</p><script>alert(1)</script>' } });
    await waitFor(() => expect(previewPage).toHaveBeenLastCalledWith({ ru: '<p>Оплата</p><script>alert(1)</script>' }));
    await waitFor(() => expect(screen.getByText(/Сервер удалит или изменит/)).toBeTruthy());
    await waitFor(() => expect(screen.getByTitle(/Предпросмотр/).getAttribute('srcdoc')).not.toContain('<script>'));
  });

  it('пустой черновик — сервер не вызывается', async () => {
    wrap({});
    expect(await screen.findByText('Для этого языка текста нет')).toBeTruthy();
    expect(previewPage).not.toHaveBeenCalled();
  });
});
