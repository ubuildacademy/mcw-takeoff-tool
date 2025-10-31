// Email service for sending invitations
// Supports SMTP configuration via environment variables

import nodemailer from 'nodemailer';

export interface InvitationEmailData {
  email: string;
  role: 'admin' | 'user';
  inviteUrl: string;
  invitedBy: string;
  expiresAt: string;
}

// Create reusable transporter
const getTransporter = () => {
  // Check if SMTP is configured
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpFrom = process.env.SMTP_FROM || smtpUser || 'noreply@meridiantakeoff.com';

  // If SMTP is not configured, return null (will log instead)
  if (!smtpHost || !smtpUser || !smtpPassword) {
    return null;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(smtpPort || '587'),
    secure: smtpPort === '465', // true for 465, false for other ports
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
    // Allow self-signed certificates (useful for some SMTP servers)
    tls: {
      rejectUnauthorized: false,
    },
  });
};

export const emailService = {
  async sendInvitation(data: InvitationEmailData): Promise<boolean> {
    try {
      const transporter = getTransporter();
      const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@meridiantakeoff.com';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      // If SMTP is not configured, log the email details instead
      if (!transporter) {
        console.log('📧 INVITATION EMAIL (SMTP not configured - email not sent):');
        console.log('=====================================');
        console.log(`To: ${data.email}`);
        console.log(`Role: ${data.role}`);
        console.log(`Invite URL: ${data.inviteUrl}`);
        console.log(`Invited by: ${data.invitedBy}`);
        console.log(`Expires: ${data.expiresAt}`);
        console.log('=====================================');
        console.log('⚠️  To enable email sending, configure SMTP environment variables:');
        console.log('   - SMTP_HOST (e.g., smtp.gmail.com)');
        console.log('   - SMTP_PORT (e.g., 587)');
        console.log('   - SMTP_USER (your email address)');
        console.log('   - SMTP_PASSWORD (your email password or app password)');
        console.log('   - SMTP_FROM (optional, defaults to SMTP_USER)');
        return false; // Return false since email wasn't actually sent
      }

      // Send the email
      const htmlContent = this.generateInvitationEmailHTML(data);
      const textContent = `You're invited to join Meridian Takeoff!
      
You've been invited to join Meridian Takeoff as a ${data.role}.

Click the link below to accept your invitation:
${data.inviteUrl}

This invitation will expire on ${new Date(data.expiresAt).toLocaleDateString()}.

Invited by: ${data.invitedBy}
`;

      const info = await transporter.sendMail({
        from: `"Meridian Takeoff" <${smtpFrom}>`,
        to: data.email,
        subject: 'You\'re invited to join Meridian Takeoff',
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
      // Log detailed error for debugging
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
            <p>&copy; 2024 Meridian Takeoff. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
};
