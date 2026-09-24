import { Injectable, Logger } from '@nestjs/common';
import { SecretBox } from '../../../shared/infrastructure/crypto/secret-box';

/**
 * Чувствительные параметры сообщения (коды подтверждения, коды сертификатов) хранятся зашифрованными
 * ключом приложения до завершения доставки, в журнале и API — только маска.
 */
@Injectable()
export class MessageSecrets {
  private readonly logger = new Logger(MessageSecrets.name);

  constructor(private readonly box: SecretBox) {}

  seal(secret: Record<string, string>): string | null {
    return Object.keys(secret).length > 0 ? this.box.encrypt(JSON.stringify(secret)) : null;
  }

  open(sealed: string | null): Record<string, string> {
    if (!sealed) return {};
    try {
      return JSON.parse(this.box.decrypt(sealed)) as Record<string, string>;
    } catch (err) {
      this.logger.error({ err }, 'Failed to decrypt notification secret params');
      return {};
    }
  }
}
