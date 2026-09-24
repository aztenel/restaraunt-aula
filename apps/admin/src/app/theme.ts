import type { ThemeConfig } from 'antd';

/** Тема админки в цветах бренда AULA (земля/золото), контраст текста — WCAG AA. */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#8a5a36',
    colorLink: '#6f4526',
    colorInfo: '#8a5a36',
    colorSuccess: '#2f7d4f',
    colorWarning: '#c8962e',
    colorError: '#b5452c',
    colorBgLayout: '#f7f3ee',
    borderRadius: 8,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  },
  components: {
    Layout: {
      siderBg: '#2a1a10',
      triggerBg: '#3f2717',
      headerBg: '#fffcf7',
      headerPadding: '0 16px',
      headerHeight: 56,
    },
    Menu: {
      darkItemBg: '#2a1a10',
      darkSubMenuItemBg: '#21150d',
      darkItemSelectedBg: '#8a5a36',
      darkGroupTitleColor: '#c19a74',
    },
  },
};
