import { Injectable, Logger } from '@nestjs/common';

/**
 * Отправка транзакционных писем через Resend (HTTP API).
 *
 * Пакет `resend` подгружается динамически, а ключ берётся из `RESEND_API_KEY`.
 * Если ключа нет или пакет недоступен — работает dev-fallback: письмо не
 * уходит, а его содержимое (ссылка) пишется в лог. Так фича работает сразу,
 * до получения ключа, и отсутствие пакета не ломает сборку.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from = process.env.MAIL_FROM || 'onboarding@resend.dev';

  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    const subject = 'Восстановление пароля — OptParts';
    const html = this.buildResetHtml(resetUrl);
    await this.send(email, subject, html, `Ссылка для сброса пароля: ${resetUrl}`);
  }

  private async send(
    to: string,
    subject: string,
    html: string,
    logText: string,
  ): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        `RESEND_API_KEY не задан — письмо на ${to} не отправлено. ${logText}`,
      );
      return;
    }

    let Resend: new (key: string) => {
      emails: { send: (opts: Record<string, unknown>) => Promise<{ error?: unknown }> };
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Resend = require('resend').Resend;
    } catch {
      this.logger.error(
        `Пакет "resend" не установлен — письмо на ${to} не отправлено. ${logText}`,
      );
      return;
    }

    try {
      const client = new Resend(apiKey);
      const { error } = await client.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });
      if (error) {
        this.logger.error(`Resend вернул ошибку при отправке на ${to}: ${JSON.stringify(error)}`);
        return;
      }
      this.logger.log(`Письмо отправлено на ${to}`);
    } catch (e) {
      this.logger.error(`Не удалось отправить письмо на ${to}: ${(e as Error).message}`);
    }
  }

  private buildResetHtml(resetUrl: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #111;">Восстановление пароля</h2>
        <p>Вы запросили сброс пароля. Нажмите кнопку ниже, чтобы задать новый пароль.
        Ссылка действительна 30 минут.</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}"
             style="background: #d32f2f; color: #fff; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Сбросить пароль
          </a>
        </p>
        <p style="color: #666; font-size: 13px;">
          Если вы не запрашивали сброс — просто проигнорируйте это письмо.
        </p>
      </div>
    `;
  }
}
