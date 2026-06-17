import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';

export const MASKED_SECRET = '********';

@Injectable()
export class SecretService {
  private devKey: Buffer | null = null;

  constructor(private readonly configService: ConfigService) {}

  isMasked(value?: string | null) {
    const trimmed = value?.trim();
    return Boolean(trimmed && /^[*•]{6,}$/.test(trimmed));
  }

  mask(value?: string | null) {
    return value?.trim() ? MASKED_SECRET : '';
  }

  isEncrypted(value?: string | null) {
    return Boolean(value?.startsWith('enc:v1:'));
  }

  encrypt(plain: string) {
    if (!plain || this.isEncrypted(plain)) {
      return plain;
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      'enc:v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decryptMaybe(value?: string | null) {
    if (!value) {
      return '';
    }

    if (this.isEncrypted(value)) {
      return this.decryptV1(value);
    }

    const legacy = this.tryDecryptLegacy(value);
    return legacy ?? value;
  }

  preserveOrEncrypt(
    nextValue: string | undefined,
    currentValue?: string | null,
  ) {
    if (nextValue === undefined || this.isMasked(nextValue)) {
      return currentValue ?? '';
    }

    const trimmed = nextValue.trim();
    return trimmed ? this.encrypt(trimmed) : '';
  }

  private decryptV1(value: string) {
    const [, version, ivText, tagText, encryptedText] = value.split(':');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
      throw new InternalServerErrorException('敏感配置格式无效');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.getKey(),
      Buffer.from(ivText, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private tryDecryptLegacy(value: string) {
    if (!/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value)) {
      return null;
    }

    const [ivHex, tagHex, dataHex] = value.split(':');
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.getLegacyKey(),
        Buffer.from(ivHex, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return decipher.update(dataHex, 'hex', 'utf8') + decipher.final('utf8');
    } catch {
      return null;
    }
  }

  private getKey() {
    const secret = this.configService.get<string>('SECRET_ENCRYPTION_KEY')?.trim();

    if (secret) {
      return createHash('sha256').update(secret).digest();
    }

    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new InternalServerErrorException(
        '生产环境必须配置 SECRET_ENCRYPTION_KEY',
      );
    }

    if (!this.devKey) {
      this.devKey = randomBytes(32);
    }
    return this.devKey;
  }

  private getLegacyKey() {
    const secret = this.configService.get<string>('SECRET_ENCRYPTION_KEY')?.trim();
    if (!secret) {
      return this.getKey();
    }

    return scryptSync(secret, 'nexus-sso-salt', 32);
  }
}
