import { ValidationError } from '../../../shared/kernel/errors';

export const PASSWORD_MIN_LENGTH = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError('password.too_short', `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  const classes = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\w\s]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    throw new ValidationError(
      'password.too_weak',
      'Password must contain at least three of: lowercase, uppercase, digits, symbols',
    );
  }
}
