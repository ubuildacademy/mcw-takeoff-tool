import { Router } from 'express';
import { supabase } from '../supabase';
import { emailService } from '../services/emailService';

const router = Router();

// Middleware to verify admin access
const verifyAdmin = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if user is admin
    const { data: userMetadata, error: metadataError } = await supabase
      .from('user_metadata')
      .select('role')
      .eq('id', user.id)
      .single();

    if (metadataError || !userMetadata || userMetadata.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all users (admin only)
router.get('/', verifyAdmin, async (req, res) => {
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
router.post('/invitations', verifyAdmin, async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const userExists = existingUsers?.users?.some((user: any) => user.email === email);
    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Check if invitation already exists
    const { data: existingInvitation } = await supabase
      .from('user_invitations')
      .select('*')
      .eq('email', email)
      .eq('status', 'pending')
      .single();

    if (existingInvitation) {
      return res.status(400).json({ error: 'Invitation already exists' });
    }

    const inviteToken = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    const { data, error } = await supabase
      .from('user_invitations')
      .insert({
        email,
        role,
        invite_token: inviteToken,
        invited_by: (req as any).user.id,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating invitation:', error);
      return res.status(500).json({ error: 'Failed to create invitation' });
    }

    // Send email invitation
    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/signup/${inviteToken}`;
    
    const emailSent = await emailService.sendInvitation({
      email,
      role,
      inviteUrl,
      invitedBy: (req as any).user.email || 'Admin',
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
    console.error('Error in create invitation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all invitations (admin only)
router.get('/invitations', verifyAdmin, async (req, res) => {
  try {
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
router.delete('/invitations/:id', verifyAdmin, async (req, res) => {
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

// Update user role (admin only)
router.patch('/:id/role', verifyAdmin, async (req, res) => {
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

// Delete user (admin only)
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Delete user from auth (this will cascade delete user_metadata and all related data)
    const { error } = await supabase.auth.admin.deleteUser(id);

    if (error) {
      console.error('Error deleting user:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error in delete user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
