// Supabase Edge Function: Send email via SMTP
// Used for invitations, reports, and transactional emails

import nodemailer from 'npm:nodemailer@6.9.10';

const transport = nodemailer.createTransport({
  host: Deno.env.get('SMTP_HOST')!,
  port: Number(Deno.env.get('SMTP_PORT') || '587'),
  secure: Deno.env.get('SMTP_SECURE') === 'true',
  auth: {
    user: Deno.env.get('SMTP_USER')!,
    pass: Deno.env.get('SMTP_PASSWORD')!,
  },
  tls: {
    rejectUnauthorized: Deno.env.get('SMTP_REJECT_UNAUTHORIZED') !== 'false',
  },
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendEmailRequest {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS, status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 405 }
    );
  }

  try {
    const body = (await req.json()) as SendEmailRequest;
    const { to, subject, text, html, replyTo } = body;

    if (!to || !subject) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject' }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const smtpFrom = Deno.env.get('SMTP_FROM') || Deno.env.get('SMTP_USER');
    if (!smtpFrom) {
      return new Response(
        JSON.stringify({ error: 'SMTP_FROM or SMTP_USER not configured' }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const mailOptions = {
      from: `"Meridian Takeoff" <${smtpFrom}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text: text || '',
      html: html || undefined,
      replyTo: replyTo || undefined,
    };

    await transport.sendMail(mailOptions);

    return new Response(
      JSON.stringify({ success: true, message: 'Email sent successfully' }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Send email error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to send email',
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
