import { v7 as uuidv7, validate as uuidValidate } from 'uuid';

/** Идентификаторы — UUID v7 (упорядочены по времени, хорошо ложатся в btree-индексы). */
export function newId(): string {
  return uuidv7();
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidValidate(value);
}
