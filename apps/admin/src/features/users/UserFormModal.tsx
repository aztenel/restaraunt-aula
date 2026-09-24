import { Form, Input, Modal, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoleAssignment, StaffUser } from '@aula/api-client';
import { usersApi } from '@/shared/api/endpoints';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { RolesEditor } from './RolesEditor';
import { normalizeRoleAssignments, validateRoleAssignments } from './roles';
import { useRoleDefinitions } from './useRoleDefinitions';

interface UserFormValues {
  email: string;
  name: string;
  phone?: string;
  telegramChatId?: string;
  password?: string;
  isActive?: boolean;
  roles?: Array<Partial<RoleAssignment>>;
}

function nullable(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Создание (с ролями и необязательным паролем — иначе сервер сгенерирует временный)
 * или редактирование профиля сотрудника.
 */
export function UserFormModal({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: StaffUser | null;
  onClose: () => void;
  onSaved: (result: { user: StaffUser; temporaryPassword: string | null }) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<UserFormValues>();
  const notifyError = useNotifyError();
  const { definitions } = useRoleDefinitions();
  const [saving, setSaving] = useState(false);
  const isEdit = user !== null;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (user) {
      form.setFieldsValue({
        email: user.email,
        name: user.name,
        phone: user.phone ?? undefined,
        telegramChatId: user.telegramChatId ?? undefined,
        isActive: user.isActive,
      });
    } else {
      form.setFieldsValue({ roles: [] });
    }
  }, [open, user, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (user) {
        const updated = await usersApi.update(user.id, {
          email: values.email.trim(),
          name: values.name.trim(),
          phone: nullable(values.phone),
          telegramChatId: nullable(values.telegramChatId),
          isActive: values.isActive,
        });
        onSaved({ user: updated, temporaryPassword: null });
      } else {
        const created = await usersApi.create({
          email: values.email.trim(),
          name: values.name.trim(),
          phone: nullable(values.phone),
          telegramChatId: nullable(values.telegramChatId),
          password: values.password || undefined,
          roles: normalizeRoleAssignments(values.roles ?? [], definitions),
        });
        onSaved(created);
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? t('users.editTitle') : t('users.createTitle')}
      okText={isEdit ? t('common.save') : t('common.create')}
      cancelText={t('common.cancel')}
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={saving}
      width={680}
      destroyOnHidden
    >
      <Form<UserFormValues> form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="name" label={t('users.name')} rules={[{ required: true, min: 2, max: 120, message: t('users.nameRule') }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="email"
          label={t('auth.email')}
          rules={[
            { required: true, message: t('common.required') },
            { type: 'email', message: t('common.invalidEmail') },
          ]}
        >
          <Input autoComplete="off" inputMode="email" />
        </Form.Item>
        <Form.Item name="phone" label={t('users.phone')} extra={t('users.phoneHint')}>
          <Input inputMode="tel" placeholder="+77001234567" />
        </Form.Item>
        <Form.Item name="telegramChatId" label={t('users.telegram')} extra={t('users.telegramHint')}>
          <Input />
        </Form.Item>
        {isEdit ? (
          <Form.Item name="isActive" label={t('users.active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        ) : (
          <>
            <Form.Item
              name="password"
              label={t('users.password')}
              extra={t('users.passwordHint')}
              rules={[{ min: 10, message: t('users.passwordMin') }]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="roles"
              label={t('users.roles')}
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
          </>
        )}
      </Form>
    </Modal>
  );
}
