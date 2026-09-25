/**
 * Редактор расстановки зала: места перетаскиваются мышью / пальцем (позиция), угол справа снизу —
 * размер, ручка сверху — поворот; стрелки — сдвиг выбранного места. Сетка привязки, числовые поля,
 * форма (прямоугольник / круг). Сохраняются только изменённые позиции (PATCH /admin/venues/{id}).
 */
import { RotateLeftOutlined, RotateRightOutlined, UndoOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Empty, Flex, InputNumber, List, Row, Segmented, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { errorMessage } from '@/shared/api/errors';
import { useStoredState } from '@/shared/lib/storage';
import { venueConfigApi, venueKeys } from './api';
import { backgroundUrl, HallPlan, type PlanShape } from './HallPlan';
import {
  changedPositions,
  clientToPlan,
  fitToPlan,
  moveVenue,
  normalizeRotation,
  resizeVenue,
  rotationFromPointer,
  screenDeltaToPlan,
  type PlanSize,
} from './plan-math';
import { VENUE_SHAPES, type Hall, type Venue, type VenuePosition } from './types';

type DragMode = 'move' | 'resize' | 'rotate';

interface DragState {
  mode: DragMode;
  id: string;
  origin: VenuePosition;
  startX: number;
  startY: number;
  rect: DOMRect;
}

const GRID_OPTIONS = [1, 5, 10, 20, 50];

export function PlanEditor({
  hall,
  venues,
  canEdit,
  onEditVenue,
  onDirtyChange,
}: {
  hall: Hall;
  venues: Venue[];
  canEdit: boolean;
  onEditVenue: (venue: Venue) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Map<string, VenuePosition>>(() => new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grid, setGrid] = useStoredState<number>('aula_admin_plan_grid', 10);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const plan: PlanSize = useMemo(() => ({ width: hall.planWidth, height: hall.planHeight }), [hall.planWidth, hall.planHeight]);

  const positionOf = (venue: Venue): VenuePosition => draft.get(venue.id) ?? venue.position;
  const changes = useMemo(() => changedPositions(venues, draft), [venues, draft]);
  const selected = venues.find((v) => v.id === selectedId) ?? null;

  useEffect(() => onDirtyChange?.(changes.length > 0), [changes.length, onDirtyChange]);

  // Перетаскивание: слушатели на окне, чтобы не терять указатель за пределами плана.
  const planRef = useRef(plan);
  planRef.current = plan;
  const gridRef = useRef(grid);
  gridRef.current = grid;
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const currentPlan = planRef.current;
      let next: VenuePosition;
      if (d.mode === 'rotate') {
        const pointer = clientToPlan({ x: event.clientX, y: event.clientY }, d.rect, currentPlan);
        next = { ...d.origin, rotation: rotationFromPointer(d.origin, pointer, event.shiftKey ? 1 : 15) };
      } else {
        const delta = screenDeltaToPlan(event.clientX - d.startX, event.clientY - d.startY, d.rect, currentPlan);
        next =
          d.mode === 'move'
            ? moveVenue(d.origin, delta, currentPlan, gridRef.current)
            : resizeVenue(d.origin, delta, currentPlan, gridRef.current, d.origin.shape === 'circle' && d.origin.w === d.origin.h);
      }
      setDraft((prev) => new Map(prev).set(d.id, next));
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const startDrag = (mode: DragMode, id: string, event: ReactPointerEvent<SVGElement>) => {
    setSelectedId(id);
    if (!canEdit || event.button !== 0) return;
    const svg = svgRef.current;
    const venue = venues.find((v) => v.id === id);
    if (!svg || !venue) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { mode, id, origin: positionOf(venue), startX: event.clientX, startY: event.clientY, rect: svg.getBoundingClientRect() };
  };

  const update = (id: string, patch: Partial<VenuePosition>) => {
    const venue = venues.find((v) => v.id === id);
    if (!venue) return;
    setDraft((prev) => new Map(prev).set(id, fitToPlan({ ...positionOf(venue), ...patch }, plan)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canEdit || !selected) return;
    const step = event.shiftKey ? 10 : 1;
    const deltas: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    setDraft((prev) => new Map(prev).set(selected.id, moveVenue(positionOf(selected), { x: delta[0], y: delta[1] }, plan, 1)));
  };

  const save = async () => {
    setSaving(true);
    const errors: string[] = [];
    const saved = new Set<string>();
    for (const change of changes) {
      try {
        await venueConfigApi.updateVenue(change.id, { position: change.position });
        saved.add(change.id);
      } catch (error) {
        const venue = venues.find((v) => v.id === change.id);
        errors.push(`${venue?.code ?? change.id}: ${errorMessage(error, i18n.language)}`);
      }
    }
    await queryClient.invalidateQueries({ queryKey: venueKeys.venues(hall.branchId) });
    void queryClient.invalidateQueries({ queryKey: ['reservations', 'timeline', hall.branchId] });
    setDraft((prev) => {
      const next = new Map(prev);
      for (const id of saved) next.delete(id);
      return next;
    });
    setFailed(errors);
    setSaving(false);
    if (errors.length === 0) void message.success(t('venues.plan.saved'));
  };

  const shapes: PlanShape[] = venues.map((venue) => {
    const changed = changes.some((c) => c.id === venue.id);
    return {
      id: venue.id,
      position: positionOf(venue),
      label: venue.code,
      sublabel: `${venue.capacityMin}–${venue.capacityMax}`,
      fill: venue.isBookable ? (changed ? '#fff1e0' : '#f3e7da') : '#f5f5f5',
      stroke: changed ? '#d97706' : venue.isBookable ? '#8a5a36' : '#bfbfbf',
      text: venue.isBookable ? '#3b2616' : '#7a7a7a',
      dashed: !venue.isBookable,
      title: `${translate(venue.name, i18n.language) || venue.code} (${venue.code})`,
    };
  });

  const selectedPosition = selected ? positionOf(selected) : null;
  const handleSize = Math.max(10, Math.round(Math.min(plan.width, plan.height) / 40));
  const overlay =
    selectedPosition && canEdit ? (
      <SelectionHandles
        position={selectedPosition}
        handleSize={handleSize}
        onResize={(event) => selected && startDrag('resize', selected.id, event)}
        onRotate={(event) => selected && startDrag('rotate', selected.id, event)}
      />
    ) : null;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={17}>
        <Flex gap={8} wrap align="center" justify="space-between" style={{ marginBottom: 8 }}>
          <Space wrap>
            <Typography.Text type="secondary">{t('venues.plan.grid')}</Typography.Text>
            <Select
              size="small"
              value={grid}
              onChange={setGrid}
              options={GRID_OPTIONS.map((value) => ({ value, label: value === 1 ? t('venues.plan.gridOff') : String(value) }))}
              style={{ width: 110 }}
            />
          </Space>
          {canEdit ? (
            <Space wrap>
              {changes.length > 0 ? <Typography.Text type="warning">{t('venues.plan.unsaved', { count: changes.length })}</Typography.Text> : null}
              <Button icon={<UndoOutlined />} disabled={changes.length === 0 || saving} onClick={() => setDraft(new Map())}>
                {t('venues.plan.reset')}
              </Button>
              <Button type="primary" disabled={changes.length === 0} loading={saving} onClick={() => void save()}>
                {t('venues.plan.save')}
              </Button>
            </Space>
          ) : null}
        </Flex>
        {failed.length > 0 ? (
          <Alert type="error" showIcon closable onClose={() => setFailed([])} message={t('venues.plan.saveFailed', { names: failed.join('; ') })} style={{ marginBottom: 8 }} />
        ) : null}
        {venues.length === 0 ? (
          <Empty description={t('venues.plan.noVenues')} />
        ) : (
          <div tabIndex={0} onKeyDown={onKeyDown} style={{ outline: 'none' }}>
            <HallPlan
              svgRef={svgRef}
              width={plan.width}
              height={plan.height}
              background={backgroundUrl(hall.background)}
              shapes={shapes}
              selectedId={selectedId}
              onShapeClick={setSelectedId}
              onShapePointerDown={(id, event) => startDrag('move', id, event)}
              onBackgroundPointerDown={() => setSelectedId(null)}
              overlay={overlay}
              ariaLabel={translate(hall.name, i18n.language)}
            />
          </div>
        )}
        {canEdit ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            {t('venues.plan.help')}
          </Typography.Paragraph>
        ) : null}
      </Col>
      <Col xs={24} xl={7}>
        <Card size="small" title={selected ? `${translate(selected.name, i18n.language) || selected.code} · ${selected.code}` : t('venues.plan.none')}>
          {selected && selectedPosition ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Row gutter={8}>
                {(['x', 'y', 'w', 'h'] as const).map((key) => (
                  <Col key={key} span={12}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t(`venues.fields.${key}`)}
                    </Typography.Text>
                    <InputNumber
                      size="small"
                      value={selectedPosition[key]}
                      min={key === 'x' || key === 'y' ? 0 : 1}
                      precision={0}
                      disabled={!canEdit}
                      onChange={(value) => typeof value === 'number' && update(selected.id, { [key]: value })}
                      style={{ width: '100%' }}
                    />
                  </Col>
                ))}
              </Row>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('venues.fields.rotation')}
                </Typography.Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Button
                    size="small"
                    icon={<RotateLeftOutlined />}
                    aria-label={t('venues.plan.rotateLeft')}
                    title={t('venues.plan.rotateLeft')}
                    disabled={!canEdit}
                    onClick={() => update(selected.id, { rotation: normalizeRotation(selectedPosition.rotation - 15) })}
                  />
                  <InputNumber
                    size="small"
                    value={selectedPosition.rotation}
                    min={0}
                    max={359}
                    precision={0}
                    disabled={!canEdit}
                    onChange={(value) => typeof value === 'number' && update(selected.id, { rotation: value })}
                    style={{ width: '100%' }}
                  />
                  <Button
                    size="small"
                    icon={<RotateRightOutlined />}
                    aria-label={t('venues.plan.rotateRight')}
                    title={t('venues.plan.rotateRight')}
                    disabled={!canEdit}
                    onClick={() => update(selected.id, { rotation: normalizeRotation(selectedPosition.rotation + 15) })}
                  />
                </Space.Compact>
              </div>
              <Segmented
                size="small"
                block
                disabled={!canEdit}
                value={selectedPosition.shape}
                onChange={(value) => update(selected.id, { shape: value as VenuePosition['shape'] })}
                options={VENUE_SHAPES.map((shape) => ({ value: shape, label: t(`venues.shapes.${shape}`) }))}
              />
              <Button block onClick={() => onEditVenue(selected)}>
                {t('venues.plan.editVenue')}
              </Button>
            </Space>
          ) : null}
        </Card>
        <List
          size="small"
          style={{ marginTop: 12, maxHeight: 360, overflow: 'auto' }}
          bordered
          dataSource={venues}
          renderItem={(venue) => (
            <List.Item
              onClick={() => setSelectedId(venue.id)}
              style={{ cursor: 'pointer', background: venue.id === selectedId ? '#fbf3ea' : undefined }}
              extra={changes.some((c) => c.id === venue.id) ? <Typography.Text type="warning">•</Typography.Text> : null}
            >
              <Typography.Text>
                <Typography.Text strong>{venue.code}</Typography.Text> {translate(venue.name, i18n.language)}
              </Typography.Text>
            </List.Item>
          )}
        />
      </Col>
    </Row>
  );
}

/** Рамка выделения (неповёрнутый прямоугольник — так позиция хранится на сервере), ручки размера и поворота. */
function SelectionHandles({
  position,
  handleSize,
  onResize,
  onRotate,
}: {
  position: VenuePosition;
  handleSize: number;
  onResize: (event: ReactPointerEvent<SVGElement>) => void;
  onRotate: (event: ReactPointerEvent<SVGElement>) => void;
}) {
  const { x, y, w, h } = position;
  // Ручка поворота над местом; у верхнего края плана — под ним (иначе она за пределами плана).
  const above = y - handleSize * 2.2 >= 0;
  const rotateY = above ? y - handleSize * 2.2 : y + h + handleSize * 2.2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#8a5a36" strokeDasharray={`${handleSize / 2} ${handleSize / 3}`} strokeWidth={handleSize / 6} pointerEvents="none" />
      <line
        x1={x + w / 2}
        y1={above ? y : y + h}
        x2={x + w / 2}
        y2={above ? rotateY + handleSize / 2 : rotateY - handleSize / 2}
        stroke="#8a5a36"
        strokeWidth={handleSize / 6}
        pointerEvents="none"
      />
      <circle
        cx={x + w / 2}
        cy={rotateY}
        r={handleSize / 2}
        fill="#fff"
        stroke="#8a5a36"
        strokeWidth={handleSize / 6}
        style={{ cursor: 'grab' }}
        onPointerDown={onRotate}
      />
      <rect
        x={x + w - handleSize / 2}
        y={y + h - handleSize / 2}
        width={handleSize}
        height={handleSize}
        fill="#8a5a36"
        style={{ cursor: 'nwse-resize' }}
        onPointerDown={onResize}
      />
    </g>
  );
}
