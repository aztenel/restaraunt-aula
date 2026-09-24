import {
  DisconnectOutlined,
  GlobalOutlined,
  KeyOutlined,
  LogoutOutlined,
  MutedOutlined,
  SoundOutlined,
  UserOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Dropdown, Select, Space, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { translate } from '@aula/api-client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { ALL_BRANCHES, useBranch } from '@/shared/branch/BranchProvider';
import { useAdminFeed } from '@/shared/feed/FeedProvider';
import { ADMIN_LANGUAGES, type AdminLanguage } from '@/shared/i18n/language';
import { unlockAudio } from '@/shared/feed/sound';

/** Переключатель филиала в шапке: влияет на списки, очереди и ленту событий. */
export function BranchSwitcher() {
  const { t, i18n } = useTranslation();
  const { branches, selection, setSelection, canSelectAll, loading } = useBranch();
  if (!loading && branches.length === 0) return null;
  const options = [
    ...(canSelectAll ? [{ value: ALL_BRANCHES, label: t('layout.allBranches') }] : []),
    ...branches.map((b) => ({ value: b.id, label: translate(b.name, i18n.language) })),
  ];
  return (
    <Select
      aria-label={t('layout.branch')}
      value={selection ?? undefined}
      onChange={setSelection}
      options={options}
      loading={loading}
      placeholder={t('layout.branchPlaceholder')}
      style={{ minWidth: 180, maxWidth: 260 }}
      popupMatchSelectWidth={false}
    />
  );
}

export function FeedIndicator() {
  const { t } = useTranslation();
  const { status, soundEnabled, setSoundEnabled } = useAdminFeed();
  const connected = status === 'open';
  return (
    <Space size={4}>
      <Tooltip title={t(`layout.feed.${status}`)}>
        {connected ? (
          <WifiOutlined style={{ color: '#2f7d4f' }} aria-label={t(`layout.feed.${status}`)} />
        ) : (
          <DisconnectOutlined style={{ color: status === 'unavailable' ? '#bfbfbf' : '#c8962e' }} aria-label={t(`layout.feed.${status}`)} />
        )}
      </Tooltip>
      <Tooltip title={soundEnabled ? t('layout.soundOn') : t('layout.soundOff')}>
        <Button
          type="text"
          aria-pressed={soundEnabled}
          aria-label={t('layout.sound')}
          icon={soundEnabled ? <SoundOutlined /> : <MutedOutlined />}
          onClick={() => {
            unlockAudio();
            setSoundEnabled(!soundEnabled);
          }}
        />
      </Tooltip>
    </Space>
  );
}

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <Select<AdminLanguage>
      aria-label={t('layout.language')}
      value={i18n.language === 'kk' ? 'kk' : 'ru'}
      onChange={(lng) => void i18n.changeLanguage(lng)}
      suffixIcon={<GlobalOutlined />}
      variant="borderless"
      style={{ width: 96 }}
      options={ADMIN_LANGUAGES.map((lng) => ({ value: lng, label: t(`languages.${lng}`) }))}
    />
  );
}

export function UserMenu() {
  const { t } = useTranslation();
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          {
            key: 'profile',
            disabled: true,
            label: (
              <div>
                <Typography.Text strong>{me.name}</Typography.Text>
                <br />
                <Typography.Text type="secondary">{me.email}</Typography.Text>
              </div>
            ),
          },
          { type: 'divider' },
          { key: 'password', icon: <KeyOutlined />, label: t('auth.changePassword'), onClick: () => navigate('/change-password') },
          {
            key: 'logout',
            icon: <LogoutOutlined />,
            danger: true,
            label: t('auth.signOut'),
            onClick: () => {
              void logout().then(() => navigate('/login', { replace: true }));
            },
          },
        ],
      }}
    >
      <Button type="text" aria-label={t('layout.userMenu')} style={{ paddingInline: 6 }}>
        <Space size={8}>
          <Avatar size="small" icon={<UserOutlined />} style={{ background: '#8a5a36' }} />
          <span className="aula-hide-sm">{me.name}</span>
        </Space>
      </Button>
    </Dropdown>
  );
}
