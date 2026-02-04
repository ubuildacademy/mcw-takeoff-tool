import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authHelpers, UserMetadata } from '../lib/supabase';

interface UserProfileProps {
  onClose: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ onClose }) => {
  const [userMetadata, setUserMetadata] = useState<UserMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState({
    fullName: '',
    company: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const metadata = await authHelpers.getUserMetadata();
        if (metadata) {
          setUserMetadata(metadata);
          setFormData({
            fullName: metadata.full_name || '',
            company: metadata.company || '',
            currentPassword: '',
            newPassword: '',
            confirmPassword: ''
          });
        }
      } catch (_err) {
        setError('Failed to load user data');
      } finally {
        setIsLoading(false);
      }
    };

    loadUserData();
  }, []);

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    setSuccess('');

    try {
      await authHelpers.updateUserMetadata({
        full_name: formData.fullName,
        company: formData.company
      });

      setSuccess('Profile updated successfully');
      // Reload user data
      const metadata = await authHelpers.getUserMetadata();
      if (metadata) {
        setUserMetadata(metadata);
      }
    } catch (_err) {
      setError('Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    setSuccess('');

    if (formData.newPassword !== formData.confirmPassword) {
      setError('New passwords do not match');
      setIsSaving(false);
      return;
    }

    if (formData.newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      setIsSaving(false);
      return;
    }

    try {
      await authHelpers.updatePassword(formData.newPassword);
      setSuccess('Password updated successfully');
      setFormData({
        ...formData,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (_err) {
      setError('Failed to update password');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    await authHelpers.signOut();
    window.location.href = '/';
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4" role="dialog" aria-modal="true" aria-labelledby="dialog-profile-loading-title" aria-busy="true">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" aria-hidden="true"></div>
            <p id="dialog-profile-loading-title" className="mt-2 text-slate-600">Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="dialog-user-profile-title">
        <div className="flex justify-between items-center mb-6">
          <h2 id="dialog-user-profile-title" className="text-2xl font-bold text-slate-900">User Profile</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3 mb-4">
            <p className="text-sm text-green-600">{success}</p>
          </div>
        )}

        <div className="space-y-8">
          {/* Profile Information */}
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Profile Information</h3>
            <form onSubmit={handleProfileUpdate} className="space-y-4">
              <div>
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Role</Label>
                <div className="mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-md">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    userMetadata?.role === 'admin' 
                      ? 'bg-purple-100 text-purple-800' 
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {userMetadata?.role === 'admin' ? 'Administrator' : 'User'}
                  </span>
                </div>
              </div>
              <Button type="submit" disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
                {isSaving ? 'Updating...' : 'Update Profile'}
              </Button>
            </form>
          </div>

          {/* Change Password */}
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Change Password</h3>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={formData.newPassword}
                  onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                  className="mt-1"
                  placeholder="Enter new password (min 8 characters)"
                />
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="mt-1"
                  placeholder="Confirm new password"
                />
              </div>
              <Button type="submit" disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
                {isSaving ? 'Updating...' : 'Update Password'}
              </Button>
            </form>
          </div>

          {/* Account Actions */}
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Account Actions</h3>
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={handleSignOut}
                className="w-full border-red-200 text-red-600 hover:bg-red-50"
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
