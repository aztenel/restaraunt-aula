import { Input, type InputProps } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moneyToDisplayText, moneyToInputText, parseMoneyInput, type MoneyInputOptions } from './money-input';

export interface MoneyInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'max'>, MoneyInputOptions {
  /** Сумма в тиынах (целое). */
  value?: number | null;
  onChange?: (value: number | null) => void;
}

/**
 * Ввод суммы в тенге с сохранением в тиынах (целое число). Совместим с Form.Item.
 * Ввод «2 500,50» → 250050. Ошибка формата подсвечивается, значение формы не меняется.
 */
export function MoneyInput({ value, onChange, allowNegative, max, onBlur, onFocus, status, ...rest }: MoneyInputProps) {
  const { i18n, t } = useTranslation();
  const locale = i18n.language;
  const [text, setText] = useState(() => moneyToDisplayText(value, locale));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  // Внешнее изменение значения (сброс формы, загрузка данных).
  useEffect(() => {
    if (focused.current) return;
    setText(moneyToDisplayText(value, locale));
    setError(null);
  }, [value, locale]);

  return (
    <Input
      {...rest}
      inputMode="decimal"
      suffix="₸"
      value={text}
      status={error ? 'error' : status}
      title={error ?? undefined}
      aria-invalid={error ? true : undefined}
      onFocus={(e) => {
        focused.current = true;
        setText(moneyToInputText(value, locale));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        const parsed = parseMoneyInput(text, { allowNegative, max });
        if (!parsed.error) setText(moneyToDisplayText(parsed.value, locale));
        onBlur?.(e);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = parseMoneyInput(next, { allowNegative, max });
        setError(parsed.error ? t(`money.${parsed.error}`) : null);
        if (!parsed.error) onChange?.(parsed.value);
      }}
    />
  );
}
