import { describe, expect, it } from 'vitest';
import { requestAbilities, sectionAbilities } from './abilities';

const banquetManager = { globalPermissions: ['banquets.view', 'banquets.manage', 'banquets.invoice', 'payments.view'], branchPermissions: {} };
const finance = { globalPermissions: ['banquets.view', 'banquets.invoice', 'payments.view', 'payments.refund'], branchPermissions: {} };
const branchManager = { globalPermissions: [], branchPermissions: { b1: ['banquets.view', 'orders.view'] } };

describe('права на заявку', () => {
  it('банкетный менеджер: ведёт заявки всех филиалов и выезды, без возвратов', () => {
    expect(requestAbilities(banquetManager, 'b2')).toEqual({ view: true, manage: true, invoice: true, documents: true, refund: false });
    expect(requestAbilities(banquetManager, null)).toMatchObject({ manage: true });
  });

  it('финансы: счета, документы и возвраты, но не воронка', () => {
    expect(requestAbilities(finance, 'b1')).toEqual({ view: true, manage: false, invoice: true, documents: true, refund: true });
  });

  it('управляющий филиалом: только просмотр своего филиала', () => {
    expect(requestAbilities(branchManager, 'b1')).toEqual({ view: true, manage: false, invoice: false, documents: false, refund: false });
    expect(requestAbilities(branchManager, 'b2').view).toBe(false);
    expect(requestAbilities(branchManager, null).view).toBe(false);
  });
});

describe('права раздела', () => {
  it('компании: правят менеджер и финансы; шаблоны — только с banquets.manage', () => {
    expect(sectionAbilities(banquetManager)).toMatchObject({ create: true, companiesEdit: true, templatesEdit: true });
    expect(sectionAbilities(finance)).toMatchObject({ create: false, companiesEdit: true, templatesEdit: false, invoices: true });
    expect(sectionAbilities(branchManager)).toMatchObject({ create: false, companiesView: true, companiesEdit: false, templatesEdit: false });
    expect(sectionAbilities(null)).toMatchObject({ companiesView: false, invoices: false });
  });
});
