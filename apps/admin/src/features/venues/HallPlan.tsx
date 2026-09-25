/**
 * План зала (SVG): фон-схема и места по позициям (x, y, w, h, прямоугольник / круг, поворот).
 * Масштабируется по ширине контейнера (viewBox в единицах плана, «xMidYMid meet»). Используется
 * картой зала в бронях (цвет — занятость) и редактором расстановки (перетаскивание — через обработчики).
 */
import { useId, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react';
import '../reservations/reservations.css';
import type { ReservationImage, VenuePosition } from './types';

export interface PlanShape {
  id: string;
  position: VenuePosition;
  /** Короткая подпись (код места). */
  label: string;
  /** Вторая строка (вместимость, время). */
  sublabel?: string;
  fill: string;
  stroke: string;
  text: string;
  dashed?: boolean;
  /** Всплывающая подсказка (полное название, состояние). */
  title: string;
  /** Подсветка новой брони. */
  highlight?: boolean;
}

/** Самый широкий вариант фона (план масштабируется). */
export function backgroundUrl(image: ReservationImage | null | undefined): string | undefined {
  if (!image) return undefined;
  const widest = [...image.variants].sort((a, b) => b.width - a.width)[0];
  return widest?.url ?? image.url;
}

export function HallPlan({
  width,
  height,
  background,
  shapes,
  selectedId,
  onShapeClick,
  onShapePointerDown,
  onBackgroundPointerDown,
  svgRef,
  overlay,
  maxHeight = '70vh',
  ariaLabel,
}: {
  width: number;
  height: number;
  background?: string;
  shapes: PlanShape[];
  selectedId?: string | null;
  onShapeClick?: (id: string) => void;
  onShapePointerDown?: (id: string, event: ReactPointerEvent<SVGGElement>) => void;
  onBackgroundPointerDown?: (event: ReactPointerEvent<SVGRectElement>) => void;
  svgRef?: Ref<SVGSVGElement>;
  /** Дополнительные элементы поверх мест (рамка выделения, ручки редактора). */
  overlay?: ReactNode;
  maxHeight?: string;
  ariaLabel?: string;
}) {
  const gridId = useId().replace(/:/g, '');
  const gridStep = Math.max(10, Math.round(Math.min(width, height) / 20));
  // Размер подписи относительно плана: читаемо при ширине экрана ~ 800–1200 px.
  const baseFont = Math.max(8, Math.round(width / 70));

  return (
    <svg
      ref={svgRef}
      className="hall-plan"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${width} / ${height}`, maxHeight }}
      role="group"
      aria-label={ariaLabel}
    >
      <defs>
        <pattern id={`grid-${gridId}`} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#efe6da" strokeWidth={1} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={width} height={height} fill={`url(#grid-${gridId})`} onPointerDown={onBackgroundPointerDown} />
      {background ? (
        <image href={background} x={0} y={0} width={width} height={height} preserveAspectRatio="xMidYMid meet" opacity={0.9} pointerEvents="none" />
      ) : null}
      {shapes.map((shape) => (
        <VenueShape
          key={shape.id}
          shape={shape}
          baseFont={baseFont}
          selected={shape.id === selectedId}
          onClick={onShapeClick}
          onPointerDown={onShapePointerDown}
        />
      ))}
      {overlay}
    </svg>
  );
}

function VenueShape({
  shape,
  baseFont,
  selected,
  onClick,
  onPointerDown,
}: {
  shape: PlanShape;
  baseFont: number;
  selected: boolean;
  onClick?: (id: string) => void;
  onPointerDown?: (id: string, event: ReactPointerEvent<SVGGElement>) => void;
}) {
  const { x, y, w, h, rotation } = shape.position;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const font = Math.max(6, Math.min(baseFont, Math.min(w, h) * 0.38));
  const strokeWidth = selected ? Math.max(3, baseFont / 4) : Math.max(1.5, baseFont / 8);
  const common = {
    className: 'hall-plan-shape',
    fill: shape.fill,
    stroke: selected ? '#8a5a36' : shape.stroke,
    strokeWidth,
    strokeDasharray: shape.dashed ? `${strokeWidth * 3} ${strokeWidth * 2}` : undefined,
  };
  return (
    <g
      className={`hall-plan-venue${shape.highlight ? ' rsv-new' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={shape.title}
      aria-pressed={selected}
      onClick={() => onClick?.(shape.id)}
      onKeyDown={(event: KeyboardEvent<SVGGElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.(shape.id);
        }
      }}
      onPointerDown={onPointerDown ? (event) => onPointerDown(shape.id, event) : undefined}
    >
      <title>{shape.title}</title>
      <g transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}>
        {shape.position.shape === 'circle' ? (
          <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} {...common} />
        ) : (
          <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) * 0.12} {...common} />
        )}
      </g>
      <text
        x={cx}
        y={shape.sublabel ? cy - font * 0.45 : cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={font}
        fontWeight={600}
        fill={shape.text}
        pointerEvents="none"
      >
        {shape.label}
      </text>
      {shape.sublabel ? (
        <text x={cx} y={cy + font * 0.65} textAnchor="middle" dominantBaseline="central" fontSize={font * 0.75} fill={shape.text} pointerEvents="none">
          {shape.sublabel}
        </text>
      ) : null}
    </g>
  );
}
