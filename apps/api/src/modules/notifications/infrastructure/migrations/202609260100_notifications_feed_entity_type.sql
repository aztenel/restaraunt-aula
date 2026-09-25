-- Тип сущности элемента ленты админки (для перехода к карточке): order, reservation, banquet_request,
-- failed_job, branch, dish. Старые записи — null (тип выводится из потока).
alter table notifications.admin_feed add column entity_type text;
