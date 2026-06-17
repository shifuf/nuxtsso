import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { createTransport } from 'nodemailer';
import { SecretService } from '../../common/security/secret.service';
import { PrismaService } from '../../database/prisma.service';

const EMAIL_CONFIG_KEY = 'email-config';

export class EmailConfigDto {
  @IsString()
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsString()
  username!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsString()
  fromAddress!: string;
}

export class TestEmailConfigDto {
  @IsOptional()
  @IsEmail()
  to?: string;
}

export interface StoredEmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

const EMPTY_CONFIG: StoredEmailConfig = {
  host: '',
  port: 465,
  secure: true,
  username: '',
  password: '',
  fromName: '',
  fromAddress: '',
};

@Injectable()
export class EmailConfigService {
  private readonly logger = new Logger(EmailConfigService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly secretService: SecretService,
  ) {}

  private hasUsableConfig(config: StoredEmailConfig) {
    return Boolean(
      config.host &&
        config.port &&
        config.username &&
        config.password &&
        config.fromAddress,
    );
  }

  private buildTransport(config: StoredEmailConfig) {
    return createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });
  }

  private buildFrom(config: StoredEmailConfig) {
    return config.fromName
      ? `"${config.fromName}" <${config.fromAddress}>`
      : config.fromAddress;
  }

  private buildVerificationContent(
    type: 'login' | 'register' | 'reset-password',
    code: string,
    expiresAt: Date,
  ) {
    const actionMap = {
      login: '登录',
      register: '注册',
      'reset-password': '重置密码',
    } as const;
    const action = actionMap[type];
    const expiresAtText = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }).format(expiresAt);

    return {
      subject: `一证通行${action}验证码`,
      text: `您正在进行${action}操作，验证码为 ${code}，10 分钟内有效，过期时间 ${expiresAtText}。如非本人操作，请忽略此邮件。`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
          <h2 style="margin:0 0 12px;font-size:20px">一证通行${action}验证码</h2>
          <p style="margin:0 0 12px">您正在进行${action}操作，请使用下面的验证码完成验证：</p>
          <div style="margin:16px 0;padding:14px 18px;background:#eff6ff;border-radius:12px;font-size:28px;font-weight:700;letter-spacing:6px;color:#0052ff;width:max-content">${code}</div>
          <p style="margin:0 0 8px">验证码 10 分钟内有效，过期时间：${expiresAtText}</p>
          <p style="margin:0;color:#64748b">如非本人操作，请直接忽略此邮件。</p>
        </div>
      `,
    };
  }

  private buildTestRecipient(config: StoredEmailConfig, to?: string) {
    const explicitRecipient = to?.trim();
    if (explicitRecipient) {
      return explicitRecipient;
    }

    if (config.fromAddress.includes('@')) {
      return config.fromAddress;
    }

    if (config.username.includes('@')) {
      return config.username;
    }

    return '';
  }

  private toSafeConfig(config: StoredEmailConfig): StoredEmailConfig {
    return {
      ...config,
      password: this.secretService.mask(config.password),
    };
  }

  private async getRuntimeConfig(): Promise<StoredEmailConfig> {
    const setting = await this.prismaService.systemSetting.findUnique({
      where: { key: EMAIL_CONFIG_KEY },
    });

    if (!setting) {
      return EMPTY_CONFIG;
    }

    try {
      const parsed = JSON.parse(setting.value) as StoredEmailConfig;
      return {
        ...EMPTY_CONFIG,
        ...parsed,
        password: this.secretService.decryptMaybe(parsed.password),
      };
    } catch {
      return EMPTY_CONFIG;
    }
  }

  async getConfig(): Promise<StoredEmailConfig> {
    return this.toSafeConfig(await this.getRuntimeConfig());
  }

  async updateConfig(dto: EmailConfigDto): Promise<StoredEmailConfig> {
    const currentSetting = await this.prismaService.systemSetting.findUnique({
      where: { key: EMAIL_CONFIG_KEY },
    });
    const current = currentSetting
      ? JSON.parse(currentSetting.value) as Partial<StoredEmailConfig>
      : {};
    const config: StoredEmailConfig = {
      host: dto.host,
      port: dto.port,
      secure: dto.secure,
      username: dto.username,
      password: this.secretService.preserveOrEncrypt(
        dto.password,
        current.password,
      ),
      fromName: dto.fromName ?? '',
      fromAddress: dto.fromAddress,
    };

    await this.prismaService.systemSetting.upsert({
      where: { key: EMAIL_CONFIG_KEY },
      update: { value: JSON.stringify(config) },
      create: { key: EMAIL_CONFIG_KEY, value: JSON.stringify(config) },
    });

    return this.toSafeConfig({
      ...config,
      password: this.secretService.decryptMaybe(config.password),
    });
  }

  async isConfigured() {
    return this.hasUsableConfig(await this.getRuntimeConfig());
  }

  async sendMail(options: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    const config = await this.getRuntimeConfig();

    if (!this.hasUsableConfig(config)) {
      throw new BadRequestException(
        '邮件服务未配置，请先填写 SMTP 服务器、认证账号和发件人地址',
      );
    }

    const transporter = this.buildTransport(config);
    return transporter.sendMail({
      from: this.buildFrom(config),
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  }

  async sendVerificationCode(
    email: string,
    type: 'login' | 'register' | 'reset-password',
    code: string,
    expiresAt: Date,
  ) {
    const content = this.buildVerificationContent(type, code, expiresAt);
    await this.sendMail({
      to: email,
      ...content,
    });
  }

  async testConfig(
    dto?: TestEmailConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    const config = await this.getRuntimeConfig();

    if (!this.hasUsableConfig(config)) {
      return {
        success: false,
        message:
          '邮件服务未配置，请先填写 SMTP 服务器、认证账号和发件人地址',
      };
    }

    const transporter = this.buildTransport(config);

    try {
      await transporter.verify();
      const recipient = this.buildTestRecipient(config, dto?.to);

      if (recipient) {
        await transporter.sendMail({
          from: this.buildFrom(config),
          to: recipient,
          subject: '一证通行 SMTP 测试邮件',
          text: `这是一封来自一证通行的测试邮件，SMTP 连接验证成功。服务器：${config.host}:${config.port}`,
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
              <h2 style="margin:0 0 12px;font-size:20px">SMTP 测试成功</h2>
              <p style="margin:0 0 8px">这是一封来自一证通行的测试邮件。</p>
              <p style="margin:0">当前 SMTP 服务器：<strong>${config.host}:${config.port}</strong></p>
            </div>
          `,
        });

        return {
          success: true,
          message: `测试邮件已发送至 ${recipient}`,
        };
      }

      return {
        success: true,
        message: `SMTP 连接验证成功 (${config.host}:${config.port})`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.warn(`SMTP test failed: ${message}`);

      return {
        success: false,
        message: `SMTP 测试失败：${message}`,
      };
    }
  }
}
