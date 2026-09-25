import { DeleteOutlined } from '@ant-design/icons';
import { Button, Empty, Flex, List, Select, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { translate, type ModifierGroup } from '@aula/api-client';
import { ReorderButtons } from '../ReorderButtons';
import { moveBy } from '../reorder';

/**
 * Группы модификаторов блюда в порядке показа (Form.Item: value — массив id).
 * Прикрепить группу, изменить порядок, открепить. Сами группы — на вкладке «Модификаторы».
 */
export function ModifierGroupsField({
  value = [],
  onChange,
  groups,
  loading,
  disabled,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
  groups: readonly ModifierGroup[];
  loading?: boolean;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const byId = new Map(groups.map((g) => [g.id, g]));
  const available = groups.filter((g) => !value.includes(g.id));

  return (
    <div>
      {value.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('catalog.dishes.noModifiers')} />
      ) : (
        <List
          size="small"
          bordered
          dataSource={value}
          renderItem={(id, index) => {
            const group = byId.get(id);
            return (
              <List.Item
                actions={
                  disabled
                    ? []
                    : [
                        <ReorderButtons key="order" index={index} count={value.length} onMove={(delta) => onChange?.(moveBy(value, index, delta))} />,
                        <Button
                          key="remove"
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t('catalog.dishes.detachModifier')}
                          onClick={() => onChange?.(value.filter((v) => v !== id))}
                        />,
                      ]
                }
              >
                <Flex gap={8} wrap align="center">
                  <Typography.Text strong>{group ? translate(group.name, i18n.language) : id}</Typography.Text>
                  {group ? (
                    <>
                      <Tag color={group.isRequired ? 'red' : 'default'}>{group.isRequired ? t('catalog.modifiers.required') : t('catalog.modifiers.optional')}</Tag>
                      <Typography.Text type="secondary">
                        {t('catalog.modifiers.selectRange', { min: group.minSelect, max: group.maxSelect })} · {t('catalog.modifiers.optionsCount', { count: group.options.length })}
                      </Typography.Text>
                      {!group.isActive ? <Tag>{t('common.inactive')}</Tag> : null}
                    </>
                  ) : (
                    <Tag color="warning">{t('catalog.dishes.unknownModifier')}</Tag>
                  )}
                </Flex>
              </List.Item>
            );
          }}
        />
      )}
      {!disabled ? (
        <Select<string>
          style={{ width: '100%', marginTop: 8 }}
          placeholder={t('catalog.dishes.attachModifier')}
          value={null as unknown as string}
          loading={loading}
          showSearch
          optionFilterProp="label"
          disabled={available.length === 0}
          onChange={(id) => id && onChange?.([...value, id])}
          options={available.map((g) => ({ value: g.id, label: `${translate(g.name, i18n.language)} (${g.code})` }))}
        />
      ) : null}
    </div>
  );
}
