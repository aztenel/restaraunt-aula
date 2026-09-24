import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Config } from '../../../shared/infrastructure/config/config';
import { sha256 } from '../../../shared/infrastructure/crypto/secret-box';
import { randomToken } from '../../../shared/kernel/random';

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: Config,
  ) {}

  signAccess(userId: string): { token: string; expiresIn: number } {
    const expiresIn = this.config.auth.accessTtlSeconds;
    const token = this.jwt.sign({ sub: userId, typ: 'access' } satisfies AccessTokenPayload, {
      secret: this.config.auth.jwtSecret,
      expiresIn,
      issuer: 'aula',
      audience: 'aula-admin',
    });
    return { token, expiresIn };
  }

  verifyAccess(token: string): AccessTokenPayload | null {
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.auth.jwtSecret,
        issuer: 'aula',
        audience: 'aula-admin',
      });
      return payload.typ === 'access' ? payload : null;
    } catch {
      return null;
    }
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = randomToken(32);
    return { token, hash: sha256(token) };
  }

  hashRefresh(token: string): string {
    return sha256(token);
  }

  refreshTtlMs(): number {
    return this.config.auth.refreshTtlDays * 24 * 3600 * 1000;
  }
}
