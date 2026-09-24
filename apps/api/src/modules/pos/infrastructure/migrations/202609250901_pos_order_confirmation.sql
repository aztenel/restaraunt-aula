-- Подтверждение создания заказа в POS. Часть POS создаёт заказ асинхронно: ответ «принято в обработку»,
-- а ошибка (касса недоступна, товар не найден) появляется позже. Пока POS не подтвердила создание,
-- confirmed_at пустой; проверка — фоновой задачей pos.confirm_order.
alter table pos.order_exports
  add column confirmed_at timestamptz,
  add column confirm_checks integer not null default 0 check (confirm_checks >= 0);

create index order_exports_unconfirmed_idx on pos.order_exports (created_at)
  where status = 'sent' and confirmed_at is null;
