// Email service for sending invitations and transactional emails.
//
// Two transports, tried in this order: (1) Microsoft Graph directly, which is what
// production uses, and (2) a Supabase Edge Function. A third path — direct SMTP via
// nodemailer — was removed 2026-08-21: it was never configured in any environment (no
// SMTP_* variable appears in server/README.md or .env.example, so following this
// project's own setup instructions could not switch it on), and it carried the last
// high-severity advisory on the server. See item 25 in docs/OPEN_ITEMS.md.

import { devLog } from '../lib/devLog';

interface InvitationEmailData {
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

interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

async function sendViaGraph(config: { clientId: string; tenantId: string; clientSecret: string; senderEmail: string }, options: { to: string | string[]; subject: string; text: string; html?: string; attachments?: EmailAttachment[] }): Promise<boolean> {
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
  const graphAttachments = (options.attachments ?? []).map((att) => {
    const contentBase64 = Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content;
    return {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.filename,
      contentType: att.contentType ?? 'application/octet-stream',
      contentBytes: contentBase64,
    };
  });
  const messageBody: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: options.html ? 'HTML' : 'Text', content: options.html || options.text },
    toRecipients: toList.map((addr) => ({ emailAddress: { address: addr } })),
  };
  if (graphAttachments.length > 0) {
    messageBody.attachments = graphAttachments;
  }
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderEmail)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: messageBody,
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

/** Log which email method is configured at startup (call from server index). */
export function logEmailConfigStatus(): void {
  const graph = getGraphConfig();
  const edge = getEdgeFunctionConfig();
  const useEdge = process.env.USE_SUPABASE_EDGE_EMAIL === 'true' && edge;

  if (graph) {
    devLog('📧 Email: Microsoft Graph (direct) – sender:', process.env.GRAPH_SENDER_EMAIL);
  } else if (useEdge) {
    devLog('📧 Email: Supabase Edge Function –', process.env.USE_GRAPH_EMAIL === 'true' ? 'Graph' : 'SMTP');
  } else {
    devLog('📧 Email: Not configured – invitations will not be sent');
    devLog('   Graph vars present:', {
      GRAPH_CLIENT_ID: !!process.env.GRAPH_CLIENT_ID,
      GRAPH_TENANT_ID: !!process.env.GRAPH_TENANT_ID,
      GRAPH_CLIENT_SECRET: !!process.env.GRAPH_CLIENT_SECRET,
      GRAPH_SENDER_EMAIL: !!process.env.GRAPH_SENDER_EMAIL,
      FRONTEND_URL: process.env.FRONTEND_URL || '(not set)',
    });
  }
}

const logInvitationFallback = (data: InvitationEmailData) => {
  const redactInviteUrl = (inviteUrl: string): string => {
    try {
      const u = new URL(inviteUrl);
      // Never log bearer-style tokens; keep only host + path for troubleshooting.
      return `${u.origin}${u.pathname}`;
    } catch {
      return '(redacted)';
    }
  };
  devLog('📧 INVITATION EMAIL (Email not configured - not sent):');
  devLog('=====================================');
  devLog(`To: ${data.email}`);
  devLog(`Role: ${data.role}`);
  devLog(`Invite URL: ${redactInviteUrl(data.inviteUrl)} (token redacted)`);
  devLog(`Invited by: ${data.invitedBy}`);
  devLog(`Expires: ${data.expiresAt}`);
  devLog('=====================================');
  devLog('⚠️  Configure either:');
  devLog('   (A) Direct Graph: GRAPH_CLIENT_ID, GRAPH_TENANT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER_EMAIL in server .env');
  devLog('   (B) Edge Function: deploy send-email-graph, set secrets, USE_SUPABASE_EDGE_EMAIL=true, USE_GRAPH_EMAIL=true');
};

export const emailService = {
  /** Send email via Microsoft Graph, falling back to the Edge Function. True if sent. */
  async sendEmail(options: {
    to: string | string[];
    subject: string;
    text: string;
    html?: string;
    attachments?: EmailAttachment[];
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

    if (useEdge && edgeConfig) {
      try {
        const body: Record<string, unknown> = {
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
        };
        if (options.attachments?.length) {
          body.attachments = options.attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
            contentType: a.contentType,
          }));
        }
        const res = await fetch(edgeConfig.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${edgeConfig.key}`,
          },
          body: JSON.stringify(body),
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

    // No transport configured. console.error rather than devLog: this is the one
    // outcome an operator needs to see, and devLog is a no-op in production.
    console.error(
      '❌ Email not sent — no transport configured. Set the GRAPH_* variables, or enable the Edge Function with USE_SUPABASE_EDGE_EMAIL=true.'
    );
    return false;
  },

  async sendInvitation(data: InvitationEmailData): Promise<boolean> {
    try {
      const graphConfig = getGraphConfig();
      const edgeConfig = getEdgeFunctionConfig();
      const useEdge =
        process.env.USE_SUPABASE_EDGE_EMAIL === 'true' && edgeConfig;

      if (!graphConfig && !useEdge) {
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

      // Unreachable: the guard above returns early unless one of the two transports
      // is configured, and both are handled. Kept explicit so a future third transport
      // cannot fall off the end of this function returning undefined.
      logInvitationFallback(data);
      return false;
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
