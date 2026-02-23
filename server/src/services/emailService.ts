// Email service for sending invitations and transactional emails
// Supports: (1) Supabase Edge Function SMTP, (2) Direct SMTP via nodemailer

import nodemailer from 'nodemailer';

export interface InvitationEmailData {
  email: string;
  role: 'admin' | 'user';
  inviteUrl: string;
  invitedBy: string;
  expiresAt: string;
}

/** Direct Graph API when all credentials are in server env. */
const getGraphConfig = () => {
  const clientId = process.env.GRAPH_CLIENT_ID;
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  const senderEmail = process.env.GRAPH_SENDER_EMAIL;
  if (!clientId || !tenantId || !clientSecret || !senderEmail) return null;
  return { clientId, tenantId, clientSecret, senderEmail };
};

/** Use Supabase Edge Function when URL and service key are set. */
const getEdgeFunctionConfig = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const useGraph = process.env.USE_GRAPH_EMAIL === 'true';
  const fn = useGraph ? 'send-email-graph' : 'send-email-smtp';
  return {
    url: `${url.replace(/\/$/, '')}/functions/v1/${fn}`,
    key,
  };
};

async function sendViaGraph(config: { clientId: string; tenantId: string; clientSecret: string; senderEmail: string }, options: { to: string | string[]; subject: string; text: string; html?: string }): Promise<boolean> {
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    }
  );
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Graph token failed: ${err}`);
  }
  const tokenData = (await tokenRes.json()) as { access_token: string };
  const access_token = tokenData.access_token;
  const toList = Array.isArray(options.to) ? options.to : [options.to];
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderEmail)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: options.subject,
          body: { contentType: options.html ? 'HTML' : 'Text', content: options.html || options.text },
          toRecipients: toList.map((addr) => ({ emailAddress: { address: addr } })),
        },
        saveToSentItems: true,
      }),
    }
  );
  if (!sendRes.ok) {
    const err = await sendRes.text();
    throw new Error(`Graph sendMail failed: ${sendRes.status} ${err}`);
  }
  return true;
}

/** Create nodemailer transport for direct SMTP (used when not using Edge Function). */
const getTransporter = () => {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;

  if (!smtpHost || !smtpUser || !smtpPassword) return null;

  return nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(smtpPort || '587'),
    secure: smtpPort === '465',
    auth: { user: smtpUser, pass: smtpPassword },
    tls: { rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false' },
  });
};

/** Log which email method is configured at startup (call from server index). */
export function logEmailConfigStatus(): void {
  const graph = getGraphConfig();
  const edge = getEdgeFunctionConfig();
  const useEdge = process.env.USE_SUPABASE_EDGE_EMAIL === 'true' && edge;
  const smtp = getTransporter();

  if (graph) {
    console.log('📧 Email: Microsoft Graph (direct) – sender:', process.env.GRAPH_SENDER_EMAIL);
  } else if (useEdge) {
    console.log('📧 Email: Supabase Edge Function –', process.env.USE_GRAPH_EMAIL === 'true' ? 'Graph' : 'SMTP');
  } else if (smtp) {
    console.log('📧 Email: Direct SMTP –', process.env.SMTP_HOST);
  } else {
    console.log('📧 Email: Not configured – invitations will not be sent');
  }
}

const logInvitationFallback = (data: InvitationEmailData) => {
  console.log('📧 INVITATION EMAIL (Email not configured - not sent):');
  console.log('=====================================');
  console.log(`To: ${data.email}`);
  console.log(`Role: ${data.role}`);
  console.log(`Invite URL: ${data.inviteUrl}`);
  console.log(`Invited by: ${data.invitedBy}`);
  console.log(`Expires: ${data.expiresAt}`);
  console.log('=====================================');
  console.log('⚠️  Configure either:');
  console.log('   (A) Direct Graph: GRAPH_CLIENT_ID, GRAPH_TENANT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER_EMAIL in server .env');
  console.log('   (B) Edge Function: deploy send-email-graph, set secrets, USE_SUPABASE_EDGE_EMAIL=true, USE_GRAPH_EMAIL=true');
  console.log('   (C) Direct SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD');
};

export const emailService = {
  /** Send email via Direct Graph, Edge Function, or direct SMTP. Returns true if sent successfully. */
  async sendEmail(options: {
    to: string | string[];
    subject: string;
    text: string;
    html?: string;
  }): Promise<boolean> {
    const graphConfig = getGraphConfig();
    if (graphConfig) {
      try {
        const ok = await sendViaGraph(graphConfig, options);
        if (ok) console.log('✅ Email sent via Microsoft Graph:', options.to);
        return ok;
      } catch (e) {
        console.error('❌ Graph send failed:', e);
        return false;
      }
    }

    const edgeConfig = getEdgeFunctionConfig();
    const useEdge =
      process.env.USE_SUPABASE_EDGE_EMAIL === 'true' && edgeConfig;

    if (useEdge) {
      try {
        const res = await fetch(edgeConfig!.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${edgeConfig!.key}`,
          },
          body: JSON.stringify({
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || `HTTP ${res.status}`);
        }
        return true;
      } catch (e) {
        console.error('❌ Edge function send email failed:', e);
        return false;
      }
    }

    const transporter = getTransporter();
    if (!transporter) return false;

    const smtpFrom =
      process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@meridiantakeoff.com';

    try {
      await transporter.sendMail({
        from: `"Meridian Takeoff" <${smtpFrom}>`,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      return true;
    } catch (e) {
      console.error('❌ Direct SMTP send failed:', e);
      return false;
    }
  },

  async sendInvitation(data: InvitationEmailData): Promise<boolean> {
    try {
      const graphConfig = getGraphConfig();
      const edgeConfig = getEdgeFunctionConfig();
      const transporter = getTransporter();
      const useEdge =
        process.env.USE_SUPABASE_EDGE_EMAIL === 'true' && edgeConfig;

      if (!graphConfig && !useEdge && !transporter) {
        logInvitationFallback(data);
        return false;
      }

      const textContent = `You're invited to join Meridian Takeoff!

You've been invited to join Meridian Takeoff as a ${data.role}.

Click the link below to accept your invitation:
${data.inviteUrl}

This invitation will expire on ${new Date(data.expiresAt).toLocaleDateString()}.

Invited by: ${data.invitedBy}
`;

      const htmlContent = this.generateInvitationEmailHTML(data);
      const subject = "You're invited to join Meridian Takeoff";

      if (graphConfig) {
        return await this.sendEmail({
          to: data.email,
          subject,
          text: textContent,
          html: htmlContent,
        });
      }

      if (useEdge) {
        const ok = await this.sendEmail({
          to: data.email,
          subject,
          text: textContent,
          html: htmlContent,
        });
        if (ok) {
          console.log('✅ Invitation email sent via Edge Function:', data.email);
        }
        return ok;
      }

      const smtpFrom =
        process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@meridiantakeoff.com';

      const info = await transporter!.sendMail({
        from: `"Meridian Takeoff" <${smtpFrom}>`,
        to: data.email,
        subject,
        text: textContent,
        html: htmlContent,
      });

      console.log('✅ Invitation email sent successfully:', {
        to: data.email,
        messageId: info.messageId,
      });
      return true;
    } catch (error) {
      console.error('❌ Error sending invitation email:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
      }
      return false;
    }
  },

  generateInvitationEmailHTML(data: InvitationEmailData): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invitation to Meridian Takeoff</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Meridian Takeoff</h1>
            <p>Professional Construction Takeoff Software</p>
          </div>
          
          <div class="content">
            <h2>You're invited to join Meridian Takeoff!</h2>
            <p>You've been invited to join Meridian Takeoff as a <strong>${data.role}</strong>.</p>
            <p>Meridian Takeoff is a professional construction takeoff software that combines precision measurement tools with AI-powered document analysis.</p>
            
            <div style="text-align: center;">
              <a href="${data.inviteUrl}" class="button">Accept Invitation</a>
            </div>
            
            <p><strong>What you can do:</strong></p>
            <ul>
              <li>Create and manage construction takeoff projects</li>
              <li>Upload and analyze blueprints and drawings</li>
              <li>Use AI-powered document chat for instant answers</li>
              <li>Generate professional takeoff reports</li>
            </ul>
            
            <p><strong>Important:</strong> This invitation will expire on ${new Date(data.expiresAt).toLocaleDateString()}.</p>
            
            <p>If you have any questions, please contact your administrator.</p>
          </div>
          
          <div class="footer">
            <p>This invitation was sent by ${data.invitedBy}</p>
            <p>&copy; ${new Date().getFullYear()} Meridian Takeoff. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
};
