-- Возвраты сумм на подарочные сертификаты (событие Payments CertificateCredited): отмена заказа,
-- оплаченного сертификатом, возвращает списанное на сертификат. Без этого остаток обязательств
-- по сертификатам занижался бы на сумму возвратов, а погашения не сходились с модулем платежей.
create table reporting.certificate_credits (
  event_id uuid primary key,
  certificate_id uuid not null,
  credited_amount bigint not null check (credited_amount >= 0),
  credited_currency char(3) not null default 'KZT',
  balance_after_amount bigint not null,
  balance_after_currency char(3) not null default 'KZT',
  branch_id uuid,
  refund_id uuid,
  payment_id uuid,
  credited_at timestamptz not null,
  credited_date date not null
);
create index certificate_credits_date_idx on reporting.certificate_credits (credited_date, branch_id);
create index certificate_credits_cert_idx on reporting.certificate_credits (certificate_id);
