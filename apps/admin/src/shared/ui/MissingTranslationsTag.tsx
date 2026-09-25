import { Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { LOCALES, type MissingTranslation } from '@aula/api-client';
import { tx } from '../i18n/tx';

/**
 * Недостающие переводы, посчитанные сервером (missingTranslations): тег с языками,
 * подсказка — по полям. Сохранение не блокирует: витрина покажет запасной язык.
 */
export function MissingTranslationsTag({ items }: { items: readonly MissingTranslation[] | null | undefined }) {
  const { t } = useTranslation();
  if (!items || items.length === 0) return null;
  const locales = LOCALES.filter((locale) => items.some((item) => item.missing.includes(locale)));
  const label = (locale: string) => tx(t, `translatable.${locale}`, locale);
  return (
    <Tooltip
      title={
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {items.map((item) => (
            <li key={item.field}>
              {tx(t, `catalog.fields.${item.field}`, item.field)}: {item.missing.map(label).join(', ')}
            </li>
          ))}
        </ul>
      }
    >
      <Tag color="warning" style={{ marginTop: 4 }}>
        {t('translatable.missing', { locales: locales.map(label).join(', ') })}
      </Tag>
    </Tooltip>
  );
}
