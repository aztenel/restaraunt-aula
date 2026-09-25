import { ArrowDownOutlined, ArrowUpOutlined, HolderOutlined } from '@ant-design/icons';
import { Button, Space, Tooltip } from 'antd';
import { useRef, type DragEvent, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

/** Кнопки «вверх/вниз» (работают и на планшете, где перетаскивание мышью недоступно). */
export function ReorderButtons({
  index,
  count,
  disabled,
  onMove,
  handle,
}: {
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (delta: -1 | 1) => void;
  /** Показать ручку перетаскивания. */
  handle?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Space size={2}>
      {handle ? <HolderOutlined aria-hidden style={{ cursor: disabled ? 'default' : 'grab', color: '#a08c78', padding: '0 4px' }} /> : null}
      <Tooltip title={t('catalog.moveUp')}>
        <Button size="small" type="text" icon={<ArrowUpOutlined />} aria-label={t('catalog.moveUp')} disabled={disabled || index === 0} onClick={() => onMove(-1)} />
      </Tooltip>
      <Tooltip title={t('catalog.moveDown')}>
        <Button
          size="small"
          type="text"
          icon={<ArrowDownOutlined />}
          aria-label={t('catalog.moveDown')}
          disabled={disabled || index >= count - 1}
          onClick={() => onMove(1)}
        />
      </Tooltip>
    </Space>
  );
}

/**
 * Перетаскивание строк таблицы (HTML5 drag-and-drop) — свойства для onRow антд-таблицы.
 *   const dnd = useRowDrag(onDrop); <Table onRow={(row) => dnd(row.id, enabled)} />
 */
export function useRowDrag(onDrop: (dragId: string, overId: string) => void) {
  const dragging = useRef<string | null>(null);
  return (id: string, enabled: boolean): HTMLAttributes<HTMLElement> => {
    if (!enabled) return {};
    return {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        dragging.current = id;
        event.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (dragging.current && dragging.current !== id) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        const from = dragging.current;
        dragging.current = null;
        if (from && from !== id) onDrop(from, id);
      },
      onDragEnd: () => {
        dragging.current = null;
      },
      style: { cursor: 'grab' },
    };
  };
}
