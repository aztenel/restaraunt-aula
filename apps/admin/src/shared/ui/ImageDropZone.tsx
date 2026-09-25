import { CloudUploadOutlined, LoadingOutlined } from '@ant-design/icons';
import { App, Typography } from 'antd';
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ALLOWED_IMAGE_TYPES, checkImageFiles } from './image-files';

export interface ImageDropZoneProps {
  /** Несколько файлов (галерея блюда). */
  multiple?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Сколько файлов ещё можно добавить. */
  limit?: number;
  hint?: ReactNode;
  children?: ReactNode;
  onFiles: (files: File[]) => void;
}

/**
 * Загрузка изображений: нажатие или перетаскивание файлов. Формат и размер проверяются до отправки
 * (JPEG/PNG/WebP, до 10 МБ), ширину и остальное проверяет сервер (ошибки — по кодам catalog.image_*).
 */
export function ImageDropZone({ multiple, disabled, loading, limit, hint, children, onFiles }: ImageDropZoneProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const inactive = disabled || loading;

  const accept = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = multiple ? [...list] : [...list].slice(0, 1);
    const { accepted, rejected } = checkImageFiles(files, limit);
    for (const { file, issue } of rejected) void message.warning(`${file.name}: ${t(`catalog.images.issues.${issue}`)}`);
    if (accepted.length > 0) onFiles(accepted);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    if (!inactive) accept(event.dataTransfer.files);
  };

  const open = () => {
    if (!inactive) input.current?.click();
  };

  return (
    <div
      role="button"
      tabIndex={inactive ? -1 : 0}
      aria-disabled={inactive || undefined}
      onClick={open}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!inactive) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      style={{
        border: `1px dashed ${over ? '#a5774f' : '#d9c6b0'}`,
        background: over ? '#fbf3ea' : '#fdfaf6',
        borderRadius: 8,
        padding: '16px 12px',
        textAlign: 'center',
        cursor: inactive ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={ALLOWED_IMAGE_TYPES.join(',')}
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = '';
        }}
      />
      <div style={{ fontSize: 24, color: '#a5774f' }}>{loading ? <LoadingOutlined /> : <CloudUploadOutlined />}</div>
      <div>{children ?? (multiple ? t('catalog.images.dropMany') : t('catalog.images.dropOne'))}</div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {hint ?? t('catalog.images.hint')}
      </Typography.Text>
    </div>
  );
}
