import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWK,
  type JWTPayload,
} from 'jose';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';

type ImportedPrivateKey = Awaited<ReturnType<typeof importPKCS8>>;
type ImportedPublicKey = Awaited<ReturnType<typeof importSPKI>>;

interface TokenPayload extends JWTPayload {
  sub: string;
  email: string;
  role: 'admin' | 'user';
  scope: string;
  aud: string;
  nonce?: string;
}

interface IssueTokenParams {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  scopes: string[];
  audience: string;
  nonce?: string;
  type?: 'access' | 'id';
}

@Injectable()
export class TokenService implements OnModuleInit {
  private privateKey!: ImportedPrivateKey;
  private publicKey!: ImportedPublicKey;
  private publicJwk!: JWK;
  private readonly algorithm = 'RS256';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const privateKeyPem = this.configService.get<string>('OIDC_PRIVATE_KEY');
    const publicKeyPem = this.configService.get<string>('OIDC_PUBLIC_KEY');

    if (privateKeyPem && publicKeyPem) {
      this.privateKey = await importPKCS8(privateKeyPem, this.algorithm);
      this.publicKey = await importSPKI(publicKeyPem, this.algorithm);
      this.publicJwk = await exportJWK(createPublicKey(publicKeyPem));
      return;
    }

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    this.privateKey = await importPKCS8(
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      this.algorithm,
    );
    this.publicKey = await importSPKI(
      publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      this.algorithm,
    );
    this.publicJwk = await exportJWK(publicKey);
  }

  getIssuer() {
    return (
      this.configService.get<string>('OIDC_ISSUER') ??
      `http://localhost:${this.configService.get<number>('PORT') ?? 3000}`
    );
  }

  getAccessTokenExpiresInSeconds() {
    return this.configService.get<number>('JWT_ACCESS_TOKEN_EXPIRES_IN') ?? 3600;
  }

  getRefreshTokenExpiresInSeconds() {
    return this.configService.get<number>('JWT_REFRESH_TOKEN_EXPIRES_IN') ?? 604800;
  }

  getKeyId() {
    return this.configService.get<string>('JWT_KEY_ID') ?? 'sso-dev-key';
  }

  async issueToken(params: IssueTokenParams) {
    if (!this.privateKey) {
      throw new InternalServerErrorException('OIDC 密钥对未就绪');
    }

    const expiresIn =
      params.type === 'id'
        ? this.getAccessTokenExpiresInSeconds()
        : this.getAccessTokenExpiresInSeconds();

    const payload: TokenPayload = {
      sub: params.userId,
      email: params.email,
      role: params.role,
      scope: params.scopes.join(' '),
      aud: params.audience,
    };

    if (params.nonce) {
      payload.nonce = params.nonce;
    }

    return new SignJWT(payload)
      .setProtectedHeader({
        alg: this.algorithm,
        kid: this.getKeyId(),
        typ: params.type === 'id' ? 'JWT' : 'at+jwt',
      })
      .setIssuer(this.getIssuer())
      .setAudience(params.audience)
      .setSubject(params.userId)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.privateKey);
  }

  async verifyToken(token: string) {
    const result = await jwtVerify(token, this.publicKey, {
      issuer: this.getIssuer(),
    });

    return result.payload as JWTPayload & TokenPayload;
  }

  getJwks() {
    return {
      keys: [
        {
          ...this.publicJwk,
          alg: this.algorithm,
          kid: this.getKeyId(),
          use: 'sig',
        },
      ],
    };
  }
}
