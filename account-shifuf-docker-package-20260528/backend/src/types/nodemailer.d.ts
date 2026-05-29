declare module 'nodemailer' {
  export interface SendMailOptions {
    to?: string | string[];
    from?: string;
    subject?: string;
    text?: string;
    html?: string;
  }

  export interface Transporter {
    verify(): Promise<void>;
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  export function createTransport(options: unknown): Transporter;
}
