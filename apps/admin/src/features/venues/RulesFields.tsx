/**
 * Поля правил брони: полный набор (тип места) и переопределения у места («Своё» или «как у типа»).
 * Границы — как у сервера (RULE_LIMITS); подписи единиц — минуты / часы.
 */
import { Col, Flex, Form, InputNumber, Row, Switch, Typography, type FormInstance } from 'antd';
import { useTranslation } from 'react-i18next';
import type { NumericRuleKey, RuleKey, VenueRules } from './types';
import { BOOLEAN_RULES, isNumericRule, NUMERIC_RULES, RULE_KEYS, RULE_LIMITS } from './venue-form';

const HOUR_RULES: readonly NumericRuleKey[] = ['cancellationDeadlineHours'];
const HINTED: readonly RuleKey[] = ['holdMinutes', 'cancellationDeadlineHours', 'cleanupMinutes', 'requiresManualConfirmation'];

function useRuleText() {
  const { t } = useTranslation();
  const unit = (key: NumericRuleKey) => (HOUR_RULES.includes(key) ? t('venues.rules.hoursUnit') : t('venues.rules.minutesUnit'));
  const hint = (key: RuleKey) =>
    HINTED.includes(key) ? t(`venues.rules.hints.${key as 'holdMinutes' | 'cancellationDeadlineHours' | 'cleanupMinutes' | 'requiresManualConfirmation'}`) : undefined;
  const format = (key: RuleKey, value: number | boolean | undefined) => {
    if (typeof value === 'boolean') return value ? t('venues.rules.yes') : t('venues.rules.no');
    if (value === undefined) return '—';
    return `${value} ${isNumericRule(key) ? unit(key) : ''}`.trim();
  };
  return { t, unit, hint, format };
}

/** Полный набор правил типа места (name: ['rules', key]). */
export function TypeRulesFields({ disabled }: { disabled?: boolean }) {
  const { t, unit, hint } = useRuleText();
  return (
    <Row gutter={12}>
      {NUMERIC_RULES.map((key) => {
        const [min, max] = RULE_LIMITS[key];
        return (
          <Col key={key} xs={24} sm={12}>
            <Form.Item name={['rules', key]} label={t(`venues.rules.${key}`)} extra={hint(key)} rules={[{ required: true, type: 'integer', min, max }]}>
              <InputNumber min={min} max={max} precision={0} addonAfter={unit(key)} style={{ width: '100%' }} disabled={disabled} />
            </Form.Item>
          </Col>
        );
      })}
      {BOOLEAN_RULES.map((key) => (
        <Col key={key} xs={24} sm={12}>
          <Form.Item name={['rules', key]} label={t(`venues.rules.${key}`)} extra={hint(key)} valuePropName="checked">
            <Switch disabled={disabled} />
          </Form.Item>
        </Col>
      ))}
    </Row>
  );
}

/** Переопределения правил у места (name: ['overrides', key, 'custom' | 'value']). */
export function OverrideRulesFields({ form, typeRules, disabled }: { form: FormInstance; typeRules: VenueRules | null; disabled?: boolean }) {
  const { t, unit, format } = useRuleText();
  const overrides = Form.useWatch('overrides', form) as Record<RuleKey, { custom?: boolean; value?: number | boolean }> | undefined;
  return (
    <Flex vertical gap={4}>
      {RULE_KEYS.map((key) => {
        const custom = Boolean(overrides?.[key]?.custom);
        const inherited = typeRules ? format(key, typeRules[key]) : '—';
        return (
          <Row key={key} gutter={8} align="middle" style={{ minHeight: 40 }}>
            <Col xs={24} sm={11}>
              <Typography.Text>{t(`venues.rules.${key}`)}</Typography.Text>
            </Col>
            <Col xs={8} sm={4}>
              <Flex align="center" gap={6}>
                <Form.Item name={['overrides', key, 'custom']} valuePropName="checked" noStyle>
                  <Switch
                    size="small"
                    disabled={disabled}
                    onChange={(checked) => {
                      // Выключили «Своё» — показываем значение типа.
                      if (!checked && typeRules) form.setFieldValue(['overrides', key, 'value'], typeRules[key]);
                    }}
                  />
                </Form.Item>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('venues.rules.custom')}
                </Typography.Text>
              </Flex>
            </Col>
            <Col xs={16} sm={9}>
              {custom ? (
                isNumericRule(key) ? (
                  <Form.Item
                    name={['overrides', key, 'value']}
                    noStyle
                    rules={[{ required: true, type: 'integer', min: RULE_LIMITS[key][0], max: RULE_LIMITS[key][1] }]}
                  >
                    <InputNumber
                      size="small"
                      min={RULE_LIMITS[key][0]}
                      max={RULE_LIMITS[key][1]}
                      precision={0}
                      addonAfter={unit(key)}
                      disabled={disabled}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                ) : (
                  <Form.Item name={['overrides', key, 'value']} valuePropName="checked" noStyle>
                    <Switch size="small" disabled={disabled} />
                  </Form.Item>
                )
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('venues.rules.inherit', { value: inherited })}
                </Typography.Text>
              )}
            </Col>
          </Row>
        );
      })}
    </Flex>
  );
}
