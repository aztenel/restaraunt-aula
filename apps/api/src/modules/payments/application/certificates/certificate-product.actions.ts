import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../../shared/infrastructure/database/database';
import { Actor } from '../../../../shared/kernel/actor';
import { Clock } from '../../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../../shared/kernel/errors';
import { newId } from '../../../../shared/kernel/ids';
import { Money } from '../../../../shared/kernel/money';
import { Permission } from '../../../../shared/kernel/permissions';
import { assertTranslatable, normalizeTranslatable, Translatable } from '../../../../shared/kernel/translatable';
import { DEFAULT_VALIDITY_MONTHS } from '../../domain/gift-certificate';
import {
  CertificateDesign,
  CertificateProduct,
  CertificateProductRepository,
  CertificateProductWrite,
  DEFAULT_DESIGN,
} from '../../infrastructure/certificate-product.repository';
import { CertificateKind } from '../../public';

export interface CertificateProductInput {
  slug: string;
  kind: CertificateKind;
  name: Translatable;
  description?: Translatable | null;
  nominal: Money;
  price: Money;
  validityMonths?: number;
  design?: Partial<CertificateDesign> | null;
  isActive?: boolean;
  sortOrder?: number;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function toWrite(input: CertificateProductInput, current: CertificateProduct | null): CertificateProductWrite {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new ValidationError('certificate_product.invalid_slug', 'Slug: latin, digits, dashes');
  if (input.kind !== 'amount' && input.kind !== 'set') {
    throw new ValidationError('certificate_product.invalid_kind', 'Kind must be amount or set');
  }
  if (!input.nominal.isPositive()) throw new ValidationError('certificate_product.invalid_nominal', 'Nominal must be positive');
  if (input.price.isNegative()) throw new ValidationError('certificate_product.invalid_price', 'Price cannot be negative');
  const validityMonths = input.validityMonths ?? current?.validityMonths ?? DEFAULT_VALIDITY_MONTHS;
  if (!Number.isInteger(validityMonths) || validityMonths < 1 || validityMonths > 60) {
    throw new ValidationError('certificate_product.invalid_validity', 'Validity must be 1..60 months');
  }
  // Для набора описание (состав набора) обязательно: оно печатается в сертификате.
  const description =
    input.kind === 'set'
      ? assertTranslatable(input.description ?? {}, 'description')
      : normalizeTranslatable((input.description ?? {}) as Record<string, unknown>);
  const design: CertificateDesign = { ...DEFAULT_DESIGN, ...(current?.design ?? {}), ...(input.design ?? {}) };
  if (!COLOR_RE.test(design.color)) throw new ValidationError('certificate_product.invalid_color', 'Color must be #RRGGBB');
  return {
    slug,
    kind: input.kind,
    name: assertTranslatable(input.name, 'name'),
    description,
    nominal: input.nominal,
    price: input.price,
    validityMonths,
    design: { color: design.color, theme: design.theme?.trim() || 'classic', imageUrl: design.imageUrl?.trim() || null },
    isActive: input.isActive ?? current?.isActive ?? true,
    sortOrder: input.sortOrder ?? current?.sortOrder ?? 0,
  };
}

function auditState(p: CertificateProductWrite): Record<string, unknown> {
  return { ...p, nominal: p.nominal.toJSON(), price: p.price.toJSON() };
}

/** Новый продукт сертификата (на сумму или на набор). Право certificates.manage. */
@Injectable()
export class CreateCertificateProduct {
  constructor(
    private readonly products: CertificateProductRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: CertificateProductInput): Promise<CertificateProduct> {
    actor.assertCan(Permission.CertificatesManage);
    const data = toWrite(input, null);
    const id = newId();
    await this.database.transaction(async () => {
      if (await this.products.findBySlug(data.slug)) {
        throw new ConflictError('certificate_product.duplicate', 'Product with this slug already exists');
      }
      await this.products.insert(id, data);
      await this.audit.record({ action: 'certificate_product.created', entityType: 'certificate_product', entityId: id, after: auditState(data) });
    });
    return (await this.products.findById(id))!;
  }
}

@Injectable()
export class UpdateCertificateProduct {
  constructor(
    private readonly products: CertificateProductRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string, input: CertificateProductInput): Promise<CertificateProduct> {
    actor.assertCan(Permission.CertificatesManage);
    const current = await this.products.findById(id);
    if (!current) throw new NotFoundError('certificate_product', id);
    const data = toWrite(input, current);
    await this.database.transaction(async () => {
      if (await this.products.findBySlug(data.slug, id)) {
        throw new ConflictError('certificate_product.duplicate', 'Product with this slug already exists');
      }
      await this.products.update(id, data);
      await this.audit.record({
        action: 'certificate_product.updated',
        entityType: 'certificate_product',
        entityId: id,
        before: auditState(current),
        after: auditState(data),
      });
    });
    return (await this.products.findById(id))!;
  }
}

/** Логическое удаление: выпущенные сертификаты и прошлые заказы хранят снимок продукта. */
@Injectable()
export class DeleteCertificateProduct {
  constructor(
    private readonly products: CertificateProductRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    actor.assertCan(Permission.CertificatesManage);
    const current = await this.products.findById(id);
    if (!current) throw new NotFoundError('certificate_product', id);
    await this.database.transaction(async () => {
      await this.products.softDelete(id, this.clock.now());
      await this.audit.record({ action: 'certificate_product.deleted', entityType: 'certificate_product', entityId: id, before: auditState(current) });
    });
  }
}
