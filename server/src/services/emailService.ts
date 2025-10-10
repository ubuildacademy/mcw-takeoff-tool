// Simple email service for sending invitations
// In production, you would integrate with a service like SendGrid, AWS SES, or similar

export interface InvitationEmailData {
  email: string;
  role: 'admin' | 'user';
  inviteUrl: string;
  invitedBy: string;
  expiresAt: string;
}

export const emailService = {
  async sendInvitation(data: InvitationEmailData): Promise<boolean> {
    try {
      // For now, just log the invitation details
      // In production, replace this with actual email sending logic
      console.log('📧 INVITATION EMAIL TO SEND:');
      console.log('=====================================');
      console.log(`To: ${data.email}`);
      console.log(`Role: ${data.role}`);
      console.log(`Invite URL: ${data.inviteUrl}`);
      console.log(`Invited by: ${data.invitedBy}`);
      console.log(`Expires: ${data.expiresAt}`);
      console.log('=====================================');
      
      // TODO: Implement actual email sending
      // Example with SendGrid:
      // const sgMail = require('@sendgrid/mail');
      // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      // 
      // const msg = {
      //   to: data.email,
      //   from: 'noreply@meridiantakeoff.com',
      //   subject: 'You\'re invited to join Meridian Takeoff',
      //   html: generateInvitationEmailHTML(data)
      // };
      // 
      // await sgMail.send(msg);

      return true;
    } catch (error) {
      console.error('Error sending invitation email:', error);
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
