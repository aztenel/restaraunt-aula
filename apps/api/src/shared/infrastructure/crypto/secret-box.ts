import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Config } from '../config/config';

/** Шифрование секретов (ключи интеграций) AES-256-GCM ключом приложения. */
@Injectable()
export class SecretBox {
  private readonly key: Buffer;

  constructor(config: Config) {
    this.key = config.encryptionKey;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join('.');
  }

  decrypt(token: string): string {
    const [version, iv, tag, data] = token.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  /** HMAC для подписей ссылок и хэширования кодов с «перцем» приложения. */
  hmac(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('hex');
  }
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(key: string | Buffer, value: string | Buffer, encoding: 'hex' | 'base64' = 'hex'): string {
  return createHmac('sha256', key).update(value).digest(encoding);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
