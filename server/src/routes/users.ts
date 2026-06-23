import crypto from 'node:crypto';
import { Router } from 'express';
import { supabase, TABLES } from '../supabase';
import { storage } from '../storage';
import { emailService } from '../services/emailService';
import { requireAuth, requireAdmin, validateUUIDParam } from '../middleware';

const router = Router();

// Get all users (admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_metadata')
      .select(`
        *,
        auth_users:auth.users!inner(email)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching users:', error);
      return res.status(500).json({ error: 'Failed to fetch users' });
    }

    res.json(data || []);
  } catch (error) {
    console.error('Error in get users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user invitation (admin only)
router.post('/invitations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email: rawEmail, role } = req.body;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : rawEmail;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check if user already exists — page through all users to avoid the
    // default 50-user page limit silently missing accounts.
    let userExists = false;
    let page = 1;
    const perPage = 1000;
    while (!userExists) {
      const { data: pageData, error: listError } = await supabase.auth.admin.listUsers({ page, perPage });
      if (listError) {
        console.error('Error listing users:', listError);
        return res.status(500).json({ error: 'Failed to check existing users' });
      }
      const users = pageData?.users ?? [];
      if (users.some((u: any) => u.email?.toLowerCase() === email)) {
        userExists = true;
        break;
      }
      if (users.length < perPage) break; // last page
      page++;
    }
    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const now = new Date().toISOString();

    // Check for an active (non-expired) pending invitation.
    const { data: activeInvitation, error: existingError } = await supabase
      .from('user_invitations')
      .select('id, expires_at')
      .eq('email', email)
      .eq('status', 'pending')
      .gte('expires_at', now)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking existing invitation:', existingError);
      return res.status(500).json({ error: 'Failed to check invitations', details: existingError.message });
    }
    if (activeInvitation) {
      return res.status(400).json({ error: 'Invitation already exists' });
    }

    // Expire any stale pending invitations for this email before creating a
    // fresh one (avoids orphaned rows blocking future re-invites).
    await supabase
      .from('user_invitations')
      .update({ status: 'expired' })
      .eq('email', email)
      .eq('status', 'pending')
      .lt('expires_at', now);

    const inviteToken = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    const { data, error } = await supabase
      .from('user_invitations')
      .insert({
        email,
        role,
        invite_token: inviteToken,
        invited_by: req.user!.id,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating invitation:', error);
      return res.status(500).json({ error: 'Failed to create invitation', details: error.message });
    }

    // Send email invitation
    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/signup/${inviteToken}`;
    
    const emailSent = await emailService.sendInvitation({
      email,
      role,
      inviteUrl,
      invitedBy: req.user!.email || 'Admin',
      expiresAt: expiresAt.toISOString()
    });

    if (!emailSent) {
      console.warn('Failed to send invitation email, but invitation was created');
    }

    res.json({
      ...data,
      invite_url: inviteUrl,
      email_sent: emailSent
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Error in create invitation:', err);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
});

// Resend invitation email (admin only)
router.post('/invitations/:id/resend', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: invitation, error: fetchError } = await supabase
      .from('user_invitations')
      .select('*')
      .eq('id', id)
      .eq('status', 'pending')
      .single();

    if (fetchError || !invitation) {
      return res.status(404).json({ error: 'Invitation not found or no longer pending' });
    }

    // Reset expiry to 7 days from now
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 7);

    await supabase
      .from('user_invitations')
      .update({ expires_at: newExpiry.toISOString() })
      .eq('id', id);

    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/signup/${invitation.invite_token}`;
    const emailSent = await emailService.sendInvitation({
      email: invitation.email,
      role: invitation.role,
      inviteUrl,
      invitedBy: req.user!.email || 'Admin',
      expiresAt: newExpiry.toISOString(),
    });

    res.json({ success: true, email_sent: emailSent, expires_at: newExpiry.toISOString() });
  } catch (error) {
    console.error('Error resending invitation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all invitations (admin only)
router.get('/invitations', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Auto-expire stale pending rows before returning the list so the UI
    // never shows an "active" invitation that has already passed its deadline.
    const fetchNow = new Date().toISOString();
    await supabase
      .from('user_invitations')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', fetchNow);

    const { data, error } = await supabase
      .from('user_invitations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching invitations:', error);
      return res.status(500).json({ error: 'Failed to fetch invitations' });
    }

    res.json(data || []);
  } catch (error) {
    console.error('Error in get invitations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete invitation (admin only)
router.delete('/invitations/:id', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('user_invitations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting invitation:', error);
      return res.status(500).json({ error: 'Failed to delete invitation' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error in delete invitation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send password reset email for a user (admin only)
router.post('/:id/reset-password', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(id);
    if (userError || !userData.user?.email) {
      return res.status(404).json({ error: 'User not found' });
    }

    const email = userData.user.email;
    const redirectTo = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password`;

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('Error generating recovery link:', linkError);
      return res.status(500).json({ error: 'Failed to generate reset link' });
    }

    const resetLink = linkData.properties.action_link;
    const emailSent = await emailService.sendEmail({
      to: email,
      subject: 'Reset your Meridian Takeoff password',
      text: `Click the link below to reset your password:\n\n${resetLink}\n\nThis link expires in 1 hour.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <div style="background:#2563eb;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
            <h2 style="margin:0">Meridian Takeoff</h2>
          </div>
          <div style="padding:24px;background:#f9fafb;border-radius:0 0 8px 8px">
            <h3>Reset your password</h3>
            <p>An admin has requested a password reset for your account.</p>
            <div style="text-align:center;margin:24px 0">
              <a href="${resetLink}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">Reset Password</a>
            </div>
            <p style="color:#6b7280;font-size:14px">This link expires in 1 hour. If you did not request this, you can ignore this email.</p>
          </div>
        </div>`,
    });

    res.json({ success: true, email_sent: emailSent });
  } catch (error) {
    console.error('Error sending password reset:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user role (admin only)
router.patch('/:id/role', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const { error } = await supabase
      .from('user_metadata')
      .update({ role })
      .eq('id', id);

    if (error) {
      console.error('Error updating user role:', error);
      return res.status(500).json({ error: 'Failed to update user role' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error in update user role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Delete all projects owned by a user, then the auth user. Shared by self-service and admin delete. */
async function deleteUserAndData(userId: string): Promise<{ error?: string }> {
  const { data: projects, error: fetchError } = await supabase
    .from(TABLES.PROJECTS)
    .select('id')
    .eq('user_id', userId);

  if (fetchError) {
    console.error('Error fetching user projects for deletion:', fetchError);
    return { error: 'Failed to delete user data' };
  }

  for (const project of projects || []) {
    try {
      await storage.deleteProject(project.id);
    } catch (deleteErr) {
      console.error(`Error deleting project ${project.id}:`, deleteErr);
    }
  }

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error('Error deleting user:', error);
    return { error: 'Failed to delete user' };
  }
  return {};
}

// Delete own account (self-service) - must be before /:id so "me" is not parsed as id
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const result = await deleteUserAndData(req.user!.id);
    if (result.error) {
      return res.status(500).json({ error: 'Failed to delete account' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error in delete own account:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (admin only)
router.delete('/:id', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteUserAndData(id);
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error in delete user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
