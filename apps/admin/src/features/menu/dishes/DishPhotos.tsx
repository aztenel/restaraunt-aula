import { ArrowLeftOutlined, ArrowRightOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, Image, Space, Tag, Tooltip, Typography } from 'antd';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Dish, DishPhoto } from '@aula/api-client';
import { catalogApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ImageDropZone } from '@/shared/ui/ImageDropZone';
import { imageVariantUrl, largestImageUrl, MAX_PHOTOS_PER_DISH } from '@/shared/ui/image-files';
import { bySortOrder, moveBy, moveById, sameOrder } from '../reorder';

/**
 * Галерея блюда: загрузка нескольких файлов (multipart), порядок (первое фото — обложка),
 * удаление. Порядок меняется оптимистично (обратимо): при ошибке возвращается прежний.
 */
export function DishPhotos({ dish, canEdit, onChange }: { dish: Dish; canEdit: boolean; onChange: (dish: Dish) => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [optimistic, setOptimistic] = useState<DishPhoto[] | null>(null);
  const dragging = useRef<string | null>(null);
  const photos = optimistic ?? bySortOrder(dish.photos);
  const left = MAX_PHOTOS_PER_DISH - photos.length;

  const applyServer = (next: Dish) => {
    onChange(next);
    void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
  };

  const upload = async (files: File[]) => {
    setUploading(true);
    try {
      applyServer(await catalogApi.uploadDishPhotos(dish.id, files));
      void message.success(t('catalog.images.uploadedMany', { count: files.length }));
    } catch (error) {
      notifyError(error);
    } finally {
      setUploading(false);
    }
  };

  const reorder = async (next: DishPhoto[]) => {
    const ids = next.map((p) => p.id);
    if (sameOrder(ids, photos.map((p) => p.id))) return;
    setOptimistic(next);
    setOrdering(true);
    try {
      applyServer(await catalogApi.reorderDishPhotos(dish.id, ids));
    } catch (error) {
      notifyError(error);
    } finally {
      setOptimistic(null);
      setOrdering(false);
    }
  };

  const busy = !canEdit || ordering;

  return (
    <div>
      <Flex gap={12} wrap>
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            draggable={!busy}
            onDragStart={() => {
              dragging.current = photo.id;
            }}
            onDragOver={(event) => {
              if (dragging.current && dragging.current !== photo.id) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragging.current;
              dragging.current = null;
              if (from && from !== photo.id) void reorder(moveById(photos, from, photo.id));
            }}
            style={{
              width: 164,
              border: '1px solid #ede0d0',
              borderRadius: 8,
              padding: 6,
              background: '#fff',
              cursor: busy ? 'default' : 'grab',
            }}
          >
            <Image
              src={imageVariantUrl(photo, 300)}
              preview={{ src: largestImageUrl(photo) }}
              width={150}
              height={110}
              style={{ objectFit: 'cover', borderRadius: 6 }}
              alt=""
            />
            <Flex justify="space-between" align="center" style={{ marginTop: 6 }}>
              {index === 0 ? <Tag color="gold">{t('catalog.images.cover')}</Tag> : <Typography.Text type="secondary">#{index + 1}</Typography.Text>}
              {canEdit ? (
                <Space size={0}>
                  <Tooltip title={t('catalog.moveUp')}>
                    <Button size="small" type="text" icon={<ArrowLeftOutlined />} aria-label={t('catalog.moveUp')} disabled={busy || index === 0} onClick={() => void reorder(moveBy(photos, index, -1))} />
                  </Tooltip>
                  <Tooltip title={t('catalog.moveDown')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowRightOutlined />}
                      aria-label={t('catalog.moveDown')}
                      disabled={busy || index === photos.length - 1}
                      onClick={() => void reorder(moveBy(photos, index, 1))}
                    />
                  </Tooltip>
                  <ConfirmAction
                    danger
                    title={t('catalog.images.deletePhotoConfirm')}
                    description={t('catalog.auditNote')}
                    buttonProps={{ size: 'small', type: 'text', icon: <DeleteOutlined />, disabled: busy, 'aria-label': t('common.delete') }}
                    successMessage={t('catalog.deleted')}
                    onConfirm={async () => applyServer(await catalogApi.deleteDishPhoto(dish.id, photo.id))}
                  >
                    {null}
                  </ConfirmAction>
                </Space>
              ) : null}
            </Flex>
          </div>
        ))}
      </Flex>
      {canEdit ? (
        <div style={{ marginTop: 12 }}>
          <ImageDropZone multiple limit={left} loading={uploading} disabled={left <= 0} onFiles={(files) => void upload(files)} hint={t('catalog.images.dishHint', { left })} />
        </div>
      ) : null}
      {photos.length === 0 && !canEdit ? <Typography.Text type="secondary">{t('catalog.dishes.noPhoto')}</Typography.Text> : null}
    </div>
  );
}
