import { Segmented, Space, Switch, Table, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diffJson, formatJsonValue, type DiffEntry, type DiffKind } from './json-diff';

const KIND_STYLE: Record<DiffKind, { background?: string; color?: string }> = {
  added: { background: '#f0f9eb' },
  removed: { background: '#fff1f0' },
  changed: { background: '#fffbe6' },
  unchanged: { color: '#8c8c8c' },
};

function Value({ value }: { value: unknown }) {
  if (value === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  const text = formatJsonValue(value);
  return (
    <Typography.Text code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text.length > 400 ? `${text.slice(0, 400)}…` : text}
    </Typography.Text>
  );
}

/** «Было → стало» для записи журнала действий: таблица изменённых полей или исходный JSON. */
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'diff' | 'raw'>('diff');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const entries = useMemo(() => diffJson(before, after), [before, after]);
  const visible = showUnchanged ? entries : entries.filter((e) => e.kind !== 'unchanged');

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <Segmented
          size="small"
          value={mode}
          onChange={(v) => setMode(v as 'diff' | 'raw')}
          options={[
            { value: 'diff', label: t('audit.diff') },
            { value: 'raw', label: t('audit.raw') },
          ]}
        />
        {mode === 'diff' ? (
          <Space size={6}>
            <Switch size="small" checked={showUnchanged} onChange={setShowUnchanged} />
            <Typography.Text type="secondary">{t('audit.showUnchanged')}</Typography.Text>
          </Space>
        ) : null}
      </Space>
      {mode === 'diff' ? (
        <Table<DiffEntry>
          size="small"
          rowKey="path"
          pagination={false}
          dataSource={visible}
          locale={{ emptyText: t('audit.noChanges') }}
          onRow={(entry) => ({ style: KIND_STYLE[entry.kind] })}
          columns={[
            { title: t('audit.field'), dataIndex: 'path', width: '30%', render: (path: string) => <Typography.Text strong>{path}</Typography.Text> },
            { title: t('audit.before'), dataIndex: 'before', render: (v: unknown) => <Value value={v} /> },
            { title: t('audit.after'), dataIndex: 'after', render: (v: unknown) => <Value value={v} /> },
          ]}
        />
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {[
            [t('audit.before'), before],
            [t('audit.after'), after],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <Typography.Text type="secondary">{String(label)}</Typography.Text>
              <pre style={{ margin: '4px 0 0', padding: 12, background: '#faf7f2', borderRadius: 8, maxHeight: 360, overflow: 'auto', fontSize: 12 }}>
                {value === undefined || value === null ? '—' : JSON.stringify(value, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </Space>
  );
}
