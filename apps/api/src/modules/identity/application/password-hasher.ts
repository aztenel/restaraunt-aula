import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Пароли — argon2id. */
@Injectable()
export class PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  private dummyHash: Promise<string> | null = null;

  /** Проверка против фиктивного хэша: время ответа не выдаёт, существует ли пользователь. */
  async dummyVerify(password: string): Promise<void> {
    this.dummyHash ??= this.hash(`dummy-${Math.random()}`);
    await this.verify(await this.dummyHash, password);
  }

  async verify(hashValue: string, password: string): Promise<boolean> {
    try {
      return await verify(hashValue, password);
    } catch {
      return false;
    }
  }
}
