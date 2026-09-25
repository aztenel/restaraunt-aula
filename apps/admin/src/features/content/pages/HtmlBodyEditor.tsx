import { ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Col, Empty, Input, Row, Space, Tabs, Tooltip, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale, type Translatable } from '@aula/api-client';
import { contentApi } from '@/shared/api/catalog';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { bodyHasText, previewBodyKey } from '../forms';

/** Стили предпросмотра — близко к типографике витрины. */
const PREVIEW_STYLE = `
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #2b2118; margin: 16px; }
  h2, h3, h4 { line-height: 1.3; margin: 1.2em 0 .5em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e6d9c8; padding: 6px 8px; text-align: left; }
  blockquote { border-left: 3px solid #d9c6b0; margin: 0; padding-left: 12px; color: #6b5a4b; }
  a { color: #a5774f; }
`;

/** HTML в изолированном iframe (sandbox без скриптов, форм и доступа к админке). */
export function SanitizedPreview({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      sandbox=""
      className="aula-page-preview"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${PREVIEW_STYLE}</style></head><body>${html}</body></html>`}
    />
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * HTML страницы по языкам: слева — редактор (textarea), справа — настоящий предпросмотр черновика:
 * сервер очищает HTML так же, как при сохранении (POST /admin/content/pages/preview), но ничего
 * не сохраняет. Если санитайзер что-то убрал или изменил — предупреждение до сохранения.
 */
export function HtmlBodyEditor({
  value,
  onChange,
  disabled,
  debounceMs = 600,
}: {
  value?: Translatable;
  onChange?: (value: Translatable) => void;
  disabled?: boolean;
  /** Задержка перед запросом предпросмотра после ввода. */
  debounceMs?: number;
}) {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState<Locale>(i18n.language === 'kk' ? 'kk' : 'ru');
  const current = value ?? {};
  const debounced = useDebounced(current, debounceMs);
  const debouncedKey = previewBodyKey(debounced);
  const preview = useQuery({
    queryKey: ['content', 'page-preview', debouncedKey],
    queryFn: () => contentApi.previewPage(debounced),
    enabled: bodyHasText(debounced),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  const waiting = bodyHasText(current) && (previewBodyKey(current) !== debouncedKey || preview.isFetching);

  const update = (locale: Locale, text: string) => {
    const next: Translatable = { ...current, [locale]: text };
    if (!text) delete next[locale];
    onChange?.(next);
  };

  return (
    <Tabs
      activeKey={active}
      onChange={(key) => setActive(key as Locale)}
      items={LOCALES.map((locale) => {
        const draft = current[locale] ?? '';
        const sanitized = bodyHasText(current) ? (preview.data?.body[locale] ?? '') : '';
        const missing = locale !== 'en' && !draft.trim();
        return {
          key: locale,
          label: (
            <span>
              {t(`translatable.${locale}`)}
              {missing ? (
                <Tooltip title={t('translatable.missingOne')}>
                  <ExclamationCircleFilled style={{ color: '#d48806', marginInlineStart: 6 }} />
                </Tooltip>
              ) : null}
            </span>
          ),
          children: (
            <Row gutter={16}>
              <Col xs={24} lg={12}>
                <Typography.Text type="secondary">{t('content.pages.htmlSource')}</Typography.Text>
                <Input.TextArea
                  lang={locale}
                  value={draft}
                  disabled={disabled}
                  onChange={(e) => update(locale, e.target.value)}
                  rows={18}
                  spellCheck={false}
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, marginTop: 4 }}
                  placeholder={'<h2>…</h2>\n<p>…</p>'}
                  aria-label={`${t('content.pages.htmlSource')} (${t(`translatable.${locale}`)})`}
                />
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 6 }}>
                  {t('content.pages.allowedTags')}
                </Typography.Paragraph>
              </Col>
              <Col xs={24} lg={12}>
                <Space size={6}>
                  <Typography.Text type="secondary">{t('content.pages.preview')}</Typography.Text>
                  {waiting ? <LoadingOutlined aria-label={t('content.pages.previewWaiting')} /> : null}
                </Space>
                <div style={{ marginTop: 4, opacity: waiting ? 0.6 : 1 }}>
                  {preview.error ? <ErrorAlert error={preview.error} onRetry={() => void preview.refetch()} /> : null}
                  {preview.data?.changed && bodyHasText(current) ? (
                    <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={t('content.pages.previewChanged')} />
                  ) : null}
                  {sanitized ? (
                    <SanitizedPreview html={sanitized} title={t('content.pages.preview')} />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={draft.trim() ? t('content.pages.previewWaiting') : t('content.pages.previewEmpty')} />
                  )}
                </div>
              </Col>
            </Row>
          ),
        };
      })}
    />
  );
}
