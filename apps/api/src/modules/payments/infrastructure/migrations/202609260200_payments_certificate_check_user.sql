-- Неудачные проверки кодов сертификатов сотрудниками учитываются по пользователю (лимит на сотрудника),
-- а не по IP: общий планшет кассы не должен блокироваться публичной защитой от подбора.
alter table payments.certificate_check_failures add column user_id uuid;
create index certificate_check_failures_user_idx on payments.certificate_check_failures (user_id, occurred_at desc)
  where user_id is not null;
