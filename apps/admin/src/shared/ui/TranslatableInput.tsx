import { ExclamationCircleFilled } from '@ant-design/icons';
import { Alert, Input, Tabs, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, missingLocales, type Locale, type Translatable } from '@aula/api-client';

export interface TranslatableInputProps {
  value?: Translatable | null;
  onChange?: (value: Translatable) => void;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Языки, отсутствие которых подсвечивается (по умолчанию kk и ru). */
  required?: readonly Locale[];
}

/**
 * Переводимое поле { kk, ru, en } с вкладками языков. Недостающий перевод (kk/ru) подсвечивается
 * на вкладке и предупреждением — сохранение не блокирует (витрина покажет запасной язык),
 * кроме случая, когда пусты оба основных языка (правило translatableRule).
 */
export function TranslatableInput({
  value,
  onChange,
  multiline,
  rows = 3,
  maxLength,
  placeholder,
  disabled,
  required = ['kk', 'ru'],
}: TranslatableInputProps) {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState<Locale>(i18n.language === 'kk' ? 'kk' : 'ru');
  const current: Translatable = value ?? {};
  const missing = missingLocales(current, required);
  const anyFilled = LOCALES.some((l) => current[l]?.trim());

  const update = (locale: Locale, text: string) => {
    const next: Translatable = { ...current, [locale]: text };
    if (!text) delete next[locale];
    onChange?.(next);
  };

  return (
    <div>
      <Tabs
        size="small"
        activeKey={active}
        onChange={(key) => setActive(key as Locale)}
        items={LOCALES.map((locale) => ({
          key: locale,
          label: (
            <span>
              {t(`translatable.${locale}`)}
              {missing.includes(locale) ? (
                <Tooltip title={t('translatable.missingOne')}>
                  <ExclamationCircleFilled style={{ color: '#d48806', marginInlineStart: 6 }} />
                </Tooltip>
              ) : null}
            </span>
          ),
          children: multiline ? (
            <Input.TextArea
              lang={locale}
              value={current[locale] ?? ''}
              rows={rows}
              maxLength={maxLength}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(e) => update(locale, e.target.value)}
            />
          ) : (
            <Input
              lang={locale}
              value={current[locale] ?? ''}
              maxLength={maxLength}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(e) => update(locale, e.target.value)}
            />
          ),
        }))}
      />
      {anyFilled && missing.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8, padding: '4px 12px' }}
          message={t('translatable.missing', { locales: missing.map((l) => t(`translatable.${l}`)).join(', ') })}
        />
      ) : null}
    </div>
  );
}

/** Правило формы: заполнен хотя бы один из основных языков (kk или ru) — как на сервере. */
export function translatableRule(message: string) {
  return {
    validator: async (_: unknown, value: Translatable | undefined) => {
      if (value?.kk?.trim() || value?.ru?.trim()) return;
      throw new Error(message);
    },
  };
}
