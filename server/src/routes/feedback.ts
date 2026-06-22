/**
 * Beta feedback endpoint.
 * Accepts multipart/form-data: name, email, subject, message, logs (JSON), screenshot (PNG, optional).
 * Sends an email via the existing email service with all context attached.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { emailService } from '../services/emailService';

const router = Router();

const FEEDBACK_RECIPIENT =
  process.env.CONTACT_EMAIL?.trim() ||
  (process.env.NODE_ENV === 'production' ? '' : 'jparido@mcwcompanies.com');

// Store screenshot in memory only (max 8 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG/JPEG screenshots are accepted'));
    }
  },
});

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

router.post('/', upload.single('screenshot'), async (req: Request, res: Response) => {
  try {
    const { name, email, subject, message, logs, url: pageUrl, userAgent } = req.body as Record<string, string>;

    if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
      return res.status(400).json({ error: 'Name, email, subject, and message are required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    let parsedLogs: LogEntry[] = [];
    if (logs) {
      try {
        parsedLogs = JSON.parse(logs) as LogEntry[];
      } catch {
        /* ignore malformed logs */
      }
    }

    const logsText =
      parsedLogs.length > 0
        ? parsedLogs
            .map((l) => `[${l.timestamp}] ${l.level.toUpperCase()}: ${l.message}`)
            .join('\n')
        : 'No errors captured.';

    const textContent = [
      `Name:    ${name.trim()}`,
      `Email:   ${email.trim()}`,
      pageUrl ? `Page:    ${pageUrl}` : null,
      userAgent ? `Browser: ${userAgent}` : null,
      '',
      '=== Feedback ===',
      message.trim(),
      '',
      '=== Console Errors ===',
      logsText,
    ]
      .filter((l) => l !== null)
      .join('\n');

    const logsHtml =
      parsedLogs.length > 0
        ? parsedLogs
            .map(
              (l) =>
                `<div style="margin-bottom:4px"><span style="color:#888;font-size:11px">${escapeHtml(l.timestamp)}</span> <strong style="color:#f97316">${escapeHtml(l.level.toUpperCase())}</strong> ${escapeHtml(l.message)}</div>`
            )
            .join('')
        : '<em style="color:#888">No errors captured.</em>';

    const htmlContent = `
      <div style="font-family:sans-serif;max-width:680px">
        <h2 style="color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px">Beta Feedback</h2>

        <table style="border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-weight:600">Name</td><td>${escapeHtml(name.trim())}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-weight:600">Email</td><td>${escapeHtml(email.trim())}</td></tr>
          ${pageUrl ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-weight:600">Page</td><td><a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></td></tr>` : ''}
          ${userAgent ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-weight:600">Browser</td><td style="font-size:12px;color:#64748b">${escapeHtml(userAgent)}</td></tr>` : ''}
        </table>

        <h3 style="color:#1e293b">Message</h3>
        <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:6px;font-family:inherit">${escapeHtml(message.trim())}</pre>

        <h3 style="color:#1e293b;margin-top:24px">Console Errors <span style="font-weight:400;font-size:14px;color:#64748b">(${parsedLogs.length} captured)</span></h3>
        <div style="background:#0f172a;border-radius:6px;padding:12px;font-family:monospace;font-size:12px;line-height:1.6;color:#e2e8f0">
          ${logsHtml}
        </div>

        ${req.file ? '<p style="margin-top:16px;color:#64748b"><em>Screenshot attached as screenshot.png</em></p>' : ''}
      </div>
    `.trim();

    const attachments = req.file
      ? [
          {
            filename: 'screenshot.png',
            content: req.file.buffer,
            contentType: 'image/png',
          },
        ]
      : [];

    const ok = await emailService.sendEmail({
      to: FEEDBACK_RECIPIENT,
      subject: `[Beta Feedback] ${subject.trim().slice(0, 80)}`,
      text: textContent,
      html: htmlContent,
      attachments,
    });

    if (!ok) {
      return res.status(500).json({ error: 'Unable to send your feedback. Please try again later.' });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Feedback] Error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
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
