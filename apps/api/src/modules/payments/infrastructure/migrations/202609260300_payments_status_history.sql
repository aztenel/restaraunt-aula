-- История статусов платежа (карточка в админке): каждый переход со временем и тем, кто его вызвал.
-- Только добавление. Для платежей, созданных до появления истории, — восстановление по отметкам времени.
create table payments.payment_status_history (
  id uuid primary key,
  payment_id uuid not null references payments.payments (id),
  from_status text,
  to_status text not null check (to_status in ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded')),
  reason text,
  actor_kind text not null check (actor_kind in ('staff', 'system', 'guest')),
  actor_user_id uuid,
  actor_name text not null,
  occurred_at timestamptz not null
);
create index payment_status_history_payment_idx on payments.payment_status_history (payment_id, occurred_at, id);
create trigger payment_status_history_append_only before update or delete on payments.payment_status_history
  for each row execute function platform.forbid_update_delete();

insert into payments.payment_status_history (id, payment_id, from_status, to_status, reason, actor_kind, actor_user_id, actor_name, occurred_at)
select gen_random_uuid(), p.id, null,
       case p.method when 'online' then 'created' when 'on_receipt' then 'pending' else 'succeeded' end,
       null, 'system', null, 'history backfill', p.created_at
from payments.payments p;

insert into payments.payment_status_history (id, payment_id, from_status, to_status, reason, actor_kind, actor_user_id, actor_name, occurred_at)
select gen_random_uuid(), p.id,
       case p.method when 'online' then 'created' when 'on_receipt' then 'pending' else 'succeeded' end,
       p.status,
       coalesce(p.failure_reason, p.cancel_reason),
       'system', null, 'history backfill',
       coalesce(p.paid_at, p.failed_at, p.cancelled_at, p.updated_at)
from payments.payments p
where p.status <> case p.method when 'online' then 'created' when 'on_receipt' then 'pending' else 'succeeded' end;
