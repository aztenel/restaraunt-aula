import { Alert, Form, Modal } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoleAssignment, StaffUser } from '@aula/api-client';
import { usersApi } from '@/shared/api/endpoints';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { RolesEditor } from './RolesEditor';
import { normalizeRoleAssignments, validateRoleAssignments } from './roles';
import { useRoleDefinitions } from './useRoleDefinitions';

/** Назначение ролей (PUT /admin/users/{id}/roles): роль привязана к филиалу или глобальная. */
export function RolesModal({ user, onClose, onSaved }: { user: StaffUser | null; onClose: () => void; onSaved: (user: StaffUser) => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ roles: Array<Partial<RoleAssignment>> }>();
  const notifyError = useNotifyError();
  const { definitions } = useRoleDefinitions();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) form.setFieldsValue({ roles: user.roles.map((r) => ({ ...r })) });
  }, [user, form]);

  const submit = async () => {
    if (!user) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      onSaved(await usersApi.setRoles(user.id, normalizeRoleAssignments(values.roles ?? [], definitions)));
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={user !== null}
      title={t('users.rolesTitle', { name: user?.name ?? '' })}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={saving}
      width={680}
      destroyOnHidden
    >
      <Alert type="info" showIcon message={t('users.rolesHint')} style={{ marginBottom: 16 }} />
      <Form form={form} layout="vertical">
        <Form.Item
          name="roles"
          rules={[
            {
              validator: async (_, roles: Array<Partial<RoleAssignment>> | undefined) => {
                const issues = validateRoleAssignments(roles ?? [], definitions);
                if (issues.length > 0) throw new Error(t(`users.roleIssues.${issues[0]!}`));
              },
            },
          ]}
        >
          <RolesEditor />
        </Form.Item>
      </Form>
    </Modal>
  );
}
