import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Checkbox, Form, Modal, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { branchMenuApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { BranchSelect } from '@/shared/ui/BranchSelect';

/**
 * Копирование меню другого филиала (запуск новой точки): недостающие блюда добавляются с ценой
 * источника, цены уже имеющихся — только с флагом «перезаписать». Стоп-лист и коды POS не копируются.
 * Двухшаговое подтверждение: выбор источника → явное подтверждение с последствиями.
 */
export function CopyMenuModal({ branchId, open, onClose }: { branchId: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { modal, message } = App.useApp();
  const notifyError = useNotifyError();
  const queryClient = useQueryClient();
  const { branches, branchName } = useBranch();
  const [fromBranchId, setFromBranchId] = useState<string | null>(null);
  const [overwritePrices, setOverwritePrices] = useState(false);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setFromBranchId(null);
    setOverwritePrices(false);
    onClose();
  };

  const run = async () => {
    if (!fromBranchId) return;
    setSaving(true);
    try {
      const result = await branchMenuApi.copy(branchId, { fromBranchId, overwritePrices });
      await queryClient.invalidateQueries({ queryKey: queryKeys.branchMenu(branchId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      void message.success(t('catalog.branchMenu.copyDone', result));
      close();
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const confirm = () => {
    if (!fromBranchId) return;
    modal.confirm({
      title: t('catalog.branchMenu.copyConfirmTitle'),
      content: (
        <div>
          <Typography.Paragraph>
            {t('catalog.branchMenu.copyConfirmText', { from: branchName(fromBranchId), to: branchName(branchId) })}
          </Typography.Paragraph>
          <Typography.Paragraph strong={overwritePrices} type={overwritePrices ? 'danger' : 'secondary'}>
            {overwritePrices ? t('catalog.branchMenu.copyOverwriteYes') : t('catalog.branchMenu.copyOverwriteNo')}
          </Typography.Paragraph>
          <Typography.Text type="secondary">{t('catalog.auditNote')}</Typography.Text>
        </div>
      ),
      okText: t('catalog.branchMenu.copySubmit'),
      okButtonProps: { danger: overwritePrices },
      cancelText: t('common.cancel'),
      onOk: run,
    });
  };

  return (
    <Modal
      open={open}
      title={t('catalog.branchMenu.copyTitle', { branch: branchName(branchId) })}
      okText={t('catalog.branchMenu.copyNext')}
      okButtonProps={{ disabled: !fromBranchId, loading: saving }}
      cancelText={t('common.cancel')}
      onOk={confirm}
      onCancel={close}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('catalog.branchMenu.copyHint')} />
      <Form layout="vertical">
        <Form.Item label={t('catalog.branchMenu.copyFrom')} required>
          <BranchSelect
            value={fromBranchId}
            onChange={setFromBranchId}
            onlyIds={branches.filter((b) => b.id !== branchId).map((b) => b.id)}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item>
          <Checkbox checked={overwritePrices} onChange={(e) => setOverwritePrices(e.target.checked)}>
            {t('catalog.branchMenu.copyOverwrite')}
          </Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}
