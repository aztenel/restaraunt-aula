import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Config } from '../config/config';
import { hmacSha256, safeEqual } from '../crypto/secret-box';

export type FileVisibility = 'public' | 'private';

export interface PutFileInput {
  key: string;
  body: Buffer;
  contentType: string;
  visibility: FileVisibility;
}

/**
 * Файлы: фото блюд (публичные), PDF смет, счетов, договоров и сертификатов (приватные, по подписанной ссылке).
 * В продакшене — S3-совместимое хранилище, в разработке — локальный диск.
 */
export abstract class FileStorage {
  abstract put(input: PutFileInput): Promise<void>;
  abstract get(key: string, visibility: FileVisibility): Promise<Buffer>;
  abstract delete(key: string, visibility: FileVisibility): Promise<void>;
  abstract publicUrl(key: string): string;
  abstract signedUrl(key: string, ttlSeconds?: number, filename?: string): Promise<string>;
}

function safeKey(key: string): string {
  const n = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  if (n.startsWith('/') || n.includes('..')) throw new Error(`Invalid storage key ${key}`);
  return n;
}

export class LocalFileStorage extends FileStorage {
  private readonly root: string;

  constructor(private readonly config: Config) {
    super();
    this.root = resolve(config.storage.localDir);
  }

  private path(key: string, visibility: FileVisibility): string {
    return join(this.root, visibility, safeKey(key));
  }

  async put(input: PutFileInput): Promise<void> {
    const p = this.path(input.key, input.visibility);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, input.body);
  }

  async get(key: string, visibility: FileVisibility): Promise<Buffer> {
    return readFile(this.path(key, visibility));
  }

  async delete(key: string, visibility: FileVisibility): Promise<void> {
    await rm(this.path(key, visibility), { force: true });
  }

  publicUrl(key: string): string {
    return `${this.config.app.apiPublicUrl}/files/public/${safeKey(key)}`;
  }

  async signedUrl(key: string, ttlSeconds = 3600, filename?: string): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(safeKey(key), expires);
    const params = new URLSearchParams({ key: safeKey(key), expires: String(expires), sig });
    if (filename) params.set('filename', filename);
    return `${this.config.app.apiPublicUrl}/files/private?${params.toString()}`;
  }

  sign(key: string, expires: number): string {
    return hmacSha256(this.config.encryptionKey, `${key}:${expires}`, 'base64').replace(/[+/=]/g, '');
  }

  verify(key: string, expires: number, sig: string): boolean {
    return expires >= Math.floor(Date.now() / 1000) && safeEqual(this.sign(key, expires), sig);
  }
}

export class S3FileStorage extends FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: Config) {
    super();
    const s3 = config.storage.s3;
    this.bucket = s3.bucket;
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: s3.forcePathStyle,
      credentials: s3.accessKey && s3.secretKey ? { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey } : undefined,
    });
  }

  private objectKey(key: string, visibility: FileVisibility): string {
    return `${visibility}/${safeKey(key)}`;
  }

  async put(input: PutFileInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(input.key, input.visibility),
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
      }),
    );
  }

  async get(key: string, visibility: FileVisibility): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key, visibility) }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string, visibility: FileVisibility): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key, visibility) }));
  }

  publicUrl(key: string): string {
    const base = this.config.storage.s3.publicUrl ?? `${this.config.storage.s3.endpoint}/${this.bucket}`;
    return `${base.replace(/\/$/, '')}/public/${safeKey(key)}`;
  }

  async signedUrl(key: string, ttlSeconds = 3600, filename?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key, 'private'),
        ResponseContentDisposition: filename ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` : undefined,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}

export function createFileStorage(config: Config): FileStorage {
  return config.storage.driver === 's3' ? new S3FileStorage(config) : new LocalFileStorage(config);
}
