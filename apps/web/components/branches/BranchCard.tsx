import { getTranslations } from 'next-intl/server';
import { translate, type PublicBranch } from '@aula/api-client';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { buttonClasses } from '@/components/ui/button';
import { ClockIcon, MapPinIcon, PhoneIcon, WhatsAppIcon } from '@/components/ui/icons';
import { telHref, whatsappHref } from '@/lib/format';
import { formatInterval, intervalsFor, weekdayInTimeZone } from '@/lib/hours';
import { routes } from '@/lib/routes';
import { OpenStatusBadge } from './OpenStatusBadge';

export async function BranchCard({ branch, locale }: { branch: PublicBranch; locale: AppLocale }) {
  const t = await getTranslations('Branches');
  const common = await getTranslations('Common');
  const name = translate(branch.name, locale);
  const today = intervalsFor(branch.openingHours, weekdayInTimeZone(new Date(), branch.timezone));
  return (
    <article className="flex h-full flex-col rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-semibold text-earth-900">
          <Link href={routes.branch(branch.slug)} className="hover:underline hover:underline-offset-4">
            {name}
          </Link>
        </h3>
        <OpenStatusBadge isOpen={branch.isOpenNow} openLabel={common('openNow')} closedLabel={common('closedNow')} />
      </div>
      <p className="mt-3 flex gap-2 text-earth-700">
        <MapPinIcon size={18} className="mt-0.5 shrink-0 text-earth-400" />
        <span>{translate(branch.address, locale)}</span>
      </p>
      <p className="mt-2 flex gap-2 text-sm text-muted">
        <ClockIcon size={18} className="shrink-0 text-earth-400" />
        <span>
          {today.length > 0
            ? t('todayHours', { hours: today.map(formatInterval).join(', ') })
            : t('closedToday')}
        </span>
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        <Link href={routes.branchMenu(branch.slug)} className={buttonClasses('primary', 'sm')}>
          {common('menu')}
        </Link>
        <Link href={routes.branch(branch.slug)} className={buttonClasses('outline', 'sm')}>
          {common('details')}
        </Link>
        <span className="ml-auto flex gap-1">
          <a href={telHref(branch.phone)} className={buttonClasses('ghost', 'sm', 'w-11 px-0')} aria-label={`${common('call')}: ${name}`}>
            <PhoneIcon />
          </a>
          {branch.whatsapp ? (
            <a
              href={whatsappHref(branch.whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('ghost', 'sm', 'w-11 px-0 text-whatsapp')}
              aria-label={`${common('writeWhatsapp')}: ${name}`}
            >
              <WhatsAppIcon />
            </a>
          ) : null}
        </span>
      </div>
    </article>
  );
}
