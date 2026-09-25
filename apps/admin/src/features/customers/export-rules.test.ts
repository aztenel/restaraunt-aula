import { describe, expect, it } from 'vitest';
import { fallbackExportName, planExport, toExportBody } from './export-rules';

describe('выгрузка гостей: правила по цели', () => {
  it('маркетинг: только гости с согласием — условие добавляется автоматически', () => {
    const plan = planExport('marketing', { tags: ['regular'] });
    expect(plan.blocker).toBeNull();
    expect(plan.effectiveFilter).toEqual({ tags: ['regular'], marketingConsent: true });
    expect(plan.notices).toEqual(['marketing_only_consented', 'marketing_consent_added', 'anonymized_excluded', 'audit_logged', 'row_limit']);
  });

  it('маркетинг с условием «с согласием» — без лишнего уведомления', () => {
    const plan = planExport('marketing', { marketingConsent: true });
    expect(plan.notices).not.toContain('marketing_consent_added');
    expect(plan.effectiveFilter).toEqual({ marketingConsent: true });
  });

  it('маркетинг с условием «без согласия» — выгрузка невозможна', () => {
    const plan = planExport('marketing', { marketingConsent: false });
    expect(plan.blocker).toBe('marketing_requires_consent');
  });

  it('сервис: цель в журнале, предупреждение о гостях без согласия', () => {
    const plan = planExport('service', { hasBanquet: true });
    expect(plan.blocker).toBeNull();
    expect(plan.effectiveFilter).toEqual({ hasBanquet: true });
    expect(plan.notices).toEqual(['service_purpose_logged', 'service_includes_unconsented', 'anonymized_excluded', 'audit_logged', 'row_limit']);
    expect(planExport('service', { marketingConsent: false }).blocker).toBeNull();
    expect(planExport('service', { marketingConsent: true }).notices).not.toContain('service_includes_unconsented');
  });

  it('тело запроса: сегмент + уточнения; пустой фильтр не передаётся', () => {
    expect(toExportBody('xlsx', 'marketing', {}, null)).toEqual({ format: 'xlsx', purpose: 'marketing' });
    expect(toExportBody('csv', 'service', { q: '701' }, 'seg-1')).toEqual({ format: 'csv', purpose: 'service', segmentId: 'seg-1', filter: { q: '701' } });
  });

  it('имя файла по умолчанию — как на сервере', () => {
    expect(fallbackExportName('marketing', 'xlsx', '2026-09-25')).toBe('aula-customers-marketing-2026-09-25.xlsx');
  });
});
