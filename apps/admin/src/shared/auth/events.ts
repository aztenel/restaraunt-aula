/**
 * События авторизации из мест вне React-дерева (глобальные обработчики TanStack Query):
 * сервер ответил 403 auth.password_change_required → показать экран смены пароля.
 */
const target = new EventTarget();

export const authEvents = {
  emitPasswordChangeRequired(): void {
    target.dispatchEvent(new Event('password-change-required'));
  },
  onPasswordChangeRequired(listener: () => void): () => void {
    target.addEventListener('password-change-required', listener);
    return () => target.removeEventListener('password-change-required', listener);
  },
};
