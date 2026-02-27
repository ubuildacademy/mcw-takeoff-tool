/**
 * Contact form endpoint - sends submissions via existing email service (Microsoft Graph or SMTP).
 * No auth required; rate limited. Recipient controlled by CONTACT_EMAIL env var.
 */
import { Router, Request, Response } from 'express';
import { emailService } from '../services/emailService';

const router = Router();

const CONTACT_RECIPIENT =
  process.env.CONTACT_EMAIL || 'jparido@mcwcompanies.com';

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, email, company, subject, message } = req.body;

    if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
      return res.status(400).json({
        error: 'Name, email, subject, and message are required.',
      });
    }

    const textContent = [
      `Name: ${name.trim()}`,
      `Email: ${email.trim()}`,
      company?.trim() ? `Company: ${company.trim()}` : null,
      '',
      'Message:',
      message.trim(),
    ]
      .filter(Boolean)
      .join('\n');

    const htmlContent = `
      <p><strong>Name:</strong> ${escapeHtml(name.trim())}</p>
      <p><strong>Email:</strong> ${escapeHtml(email.trim())}</p>
      ${company?.trim() ? `<p><strong>Company:</strong> ${escapeHtml(company.trim())}</p>` : ''}
      <p><strong>Message:</strong></p>
      <pre style="white-space: pre-wrap; background: #f4f4f4; padding: 12px; border-radius: 6px;">${escapeHtml(message.trim())}</pre>
    `.trim();

    const ok = await emailService.sendEmail({
      to: CONTACT_RECIPIENT,
      subject: `[Meridian Takeoff Contact] ${subject.trim().slice(0, 80)}`,
      text: textContent,
      html: htmlContent,
    });

    if (!ok) {
      return res.status(500).json({
        error: 'Unable to send your message. Please try again later.',
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Contact] Error:', err);
    res.status(500).json({
      error: 'Something went wrong. Please try again later.',
    });
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default router;
