import { getTranslations } from 'next-intl/server';
import { translate, type PublicBranch } from '@aula/api-client';
import type { AppLocale } from '@/i18n/routing';
import { buttonClasses } from '@/components/ui/button';
import { PhoneIcon, WhatsAppIcon } from '@/components/ui/icons';
import { formatPhone, telHref, whatsappHref } from '@/lib/format';
import { OpenStatusBadge } from './OpenStatusBadge';

/**
 * Контакты филиалов для связи напрямую (запасной канал, пока онлайн-форма раздела не подключена,
 * и при недоступности онлайн-сервисов).
 */
export async function BranchContactList({
  branches,
  locale,
  whatsappText,
}: {
  branches: PublicBranch[];
  locale: AppLocale;
  whatsappText?: string;
}) {
  const common = await getTranslations('Common');
  if (branches.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {branches.map((branch) => (
        <li key={branch.id} className="rounded-2xl border border-earth-100 bg-cream-50 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-earth-900">{translate(branch.name, locale)}</p>
            <OpenStatusBadge isOpen={branch.isOpenNow} openLabel={common('openNow')} closedLabel={common('closedNow')} />
          </div>
          <p className="mt-1 text-sm text-muted">{translate(branch.address, locale)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={telHref(branch.phone)} className={buttonClasses('outline', 'sm')}>
              <PhoneIcon size={18} />
              {formatPhone(branch.phone)}
            </a>
            {branch.whatsapp ? (
              <a
                href={whatsappHref(branch.whatsapp, whatsappText)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses('whatsapp', 'sm')}
              >
                <WhatsAppIcon size={18} />
                {common('whatsapp')}
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
