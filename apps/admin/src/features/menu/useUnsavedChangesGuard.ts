import { App } from 'antd';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router';

/**
 * Предупреждение о несохранённых изменениях при уходе со страницы редактора.
 * Возвращает ref: true — есть несохранённые правки (ставится в onValuesChange формы),
 * false — после сохранения/удаления (переход не блокируется).
 */
export function useUnsavedChangesGuard(enabled: boolean) {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const dirty = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => enabled && dirty.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    modal.confirm({
      title: t('catalog.unsaved.title'),
      content: t('catalog.unsaved.text'),
      okText: t('catalog.unsaved.leave'),
      cancelText: t('catalog.unsaved.stay'),
      okButtonProps: { danger: true },
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
  }, [blocker, modal, t]);

  return dirty;
}
