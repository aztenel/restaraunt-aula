/**
 * Каждый тест — отдельный «гость»: свой номер телефона (лимиты кодов SMS и промокодов — на номер)
 * и свой IP клиента (лимиты частоты форм API — на IP; API за reverse proxy доверяет X-Forwarded-For).
 */
import { randomInt } from 'node:crypto';

export interface Guest {
  name: string;
  /** +7 7XX XXX XX XX */
  phone: string;
  email: string;
  ip: string;
}

export function guestIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export function newGuest(name = 'Тест Гость'): Guest {
  const operator = ['701', '702', '705', '707', '708', '747', '771', '775', '777', '778'][randomInt(0, 10)]!;
  const rest = String(randomInt(0, 10_000_000)).padStart(7, '0');
  return {
    name,
    phone: `+7 ${operator} ${rest.slice(0, 3)} ${rest.slice(3, 5)} ${rest.slice(5, 7)}`,
    email: `e2e.${Date.now().toString(36)}${randomInt(0, 1000)}@example.kz`,
    ip: guestIp(),
  };
}

/** Дата филиала (Asia/Almaty) через n дней: YYYY-MM-DD. */
export function localDate(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
}
