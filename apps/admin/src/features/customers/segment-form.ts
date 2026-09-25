/**
 * Сегмент гостей — сохранённый фильтр для выгрузок (SaveSegmentDto): название 1–120 символов,
 * описание до 500, фильтр — CustomerFilterDto.
 */
import type { CustomerFilterDto, SaveSegmentBody } from './types';

export interface SegmentFormValues {
  name: string;
  description: string;
}

export type SegmentFormIssue = 'name_required' | 'name_too_long' | 'description_too_long';

export function validateSegmentForm(values: SegmentFormValues): Partial<Record<'name' | 'description', SegmentFormIssue>> {
  const errors: Partial<Record<'name' | 'description', SegmentFormIssue>> = {};
  const name = values.name.trim();
  if (!name) errors.name = 'name_required';
  else if (name.length > 120) errors.name = 'name_too_long';
  if (values.description.trim().length > 500) errors.description = 'description_too_long';
  return errors;
}

export function toSaveSegmentBody(values: SegmentFormValues, filter: CustomerFilterDto): SaveSegmentBody {
  return { name: values.name.trim(), description: values.description.trim() || null, filter };
}
