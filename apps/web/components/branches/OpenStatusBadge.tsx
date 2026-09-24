import clsx from 'clsx';

/** «Открыто/Закрыто» — значение посчитано сервером (isOpenNow) по часам работы филиала. */
export function OpenStatusBadge({ isOpen, openLabel, closedLabel }: { isOpen: boolean; openLabel: string; closedLabel: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold',
        isOpen ? 'bg-steppe-100 text-steppe-700' : 'bg-earth-100 text-earth-700',
      )}
    >
      <span className={clsx('h-2 w-2 rounded-full', isOpen ? 'bg-steppe-700' : 'bg-earth-400')} aria-hidden="true" />
      {isOpen ? openLabel : closedLabel}
    </span>
  );
}
