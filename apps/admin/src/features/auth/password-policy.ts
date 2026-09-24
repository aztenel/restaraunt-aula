/**
 * Подсказка о сложности пароля на клиенте — то же правило, что на сервере
 * (identity/domain/password-policy.ts): ≥10 символов и ≥3 типа символов. Сервер проверяет сам.
 */
export const PASSWORD_MIN_LENGTH = 10;

export function passwordStrengthIssues(password: string): Array<'too_short' | 'too_weak'> {
  const issues: Array<'too_short' | 'too_weak'> = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push('too_short');
  const classes = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\w\s]/].filter((re) => re.test(password)).length;
  if (classes < 3) issues.push('too_weak');
  return issues;
}
