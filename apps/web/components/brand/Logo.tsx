import clsx from 'clsx';
import { RamHorn } from './Ornament';

/** Логотип-словознак AULA с орнаментом. */
export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <span
        className={clsx(
          'grid h-9 w-9 place-items-center rounded-xl',
          inverted ? 'bg-gold-400 text-earth-900' : 'bg-earth-700 text-gold-300',
        )}
      >
        <RamHorn className="h-5 w-7" strokeWidth={3} />
      </span>
      <span
        className={clsx(
          'font-display text-xl font-semibold tracking-[0.18em]',
          inverted ? 'text-cream-50' : 'text-earth-800',
        )}
      >
        AULA
      </span>
    </span>
  );
}
