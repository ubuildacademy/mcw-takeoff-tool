import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authHelpers } from '../lib/supabase';
import { authService } from '../services/apiService';

/** Minimal invitation shape for signup form (from API validation) */
interface InvitationInfo {
  email: string;
  role: string;
}

const SignupPage: React.FC = () => {
  const { inviteToken } = useParams<{ inviteToken: string }>();
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    fullName: '',
    company: '',
    password: '',
    confirmPassword: ''
  });
  const navigate = useNavigate();

  useEffect(() => {
    const validateInvitation = async () => {
      if (!inviteToken) {
        setError('Invalid invitation link');
        setIsValidating(false);
        return;
      }

      try {
        const inv = await authService.validateInvite(inviteToken);
        if (inv) {
          setInvitation({ email: inv.email, role: inv.role });
        } else {
          setError('Invalid or expired invitation');
        }
      } catch {
        setError('Failed to validate invitation');
      } finally {
        setIsValidating(false);
      }
    };

    validateInvitation();
  }, [inviteToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      setIsLoading(false);
      return;
    }

    const email = invitation?.email;
    if (!email) {
      setError('Invalid or missing invitation.');
      return;
    }
    try {
      let hasSession = false;

      // Sign up the user
      const { data: signUpData, error: signUpError } = await authHelpers.signUp(
        email,
        formData.password,
        {
          full_name: formData.fullName,
          company: formData.company
        }
      );

      if (signUpError) {
        // User may have already confirmed and returned to complete setup
        if (
          signUpError.message?.toLowerCase().includes('already been registered') ||
          signUpError.message?.toLowerCase().includes('already registered') ||
          signUpError.message?.toLowerCase().includes('already exists')
        ) {
          const { error: signInError } = await authHelpers.signInViaProxy(email, formData.password);
          if (!signInError) hasSession = true;
        }
        if (!hasSession) {
          setError(signUpError.message);
          return;
        }
      } else {
        hasSession = !!(await authHelpers.getCurrentUser());
        if (!hasSession) {
          setError(
            'Please check your email to confirm your account. After confirming, return to this page using the same invitation link to complete setup.'
          );
          return;
        }
      }

      // Accept the invitation (uses backend API with session)
      if (!inviteToken) {
        setError('Invalid or missing invitation token.');
        return;
      }
      await authService.acceptInvitation(inviteToken, {
        full_name: formData.fullName,
        company: formData.company
      });

      navigate('/app');
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-slate-600">Validating invitation...</p>
        </div>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">
            Meridian <span className="text-blue-600">Takeoff</span>
          </h1>
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-red-600">{error}</p>
          </div>
          <Link
            to="/"
            className="mt-4 inline-block text-blue-600 hover:text-blue-500"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-900">
            Meridian <span className="text-blue-600">Takeoff</span>
          </h1>
          <h2 className="mt-6 text-2xl font-semibold text-slate-700">
            Complete your account setup
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            You've been invited to join as a {invitation.role}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={invitation.email}
                disabled
                className="mt-1 bg-slate-50"
              />
            </div>
            <div>
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className="mt-1"
                placeholder="Enter your full name"
              />
            </div>
            <div>
              <Label htmlFor="company">Company (Optional)</Label>
              <Input
                id="company"
                name="company"
                type="text"
                autoComplete="organization"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className="mt-1"
                placeholder="Enter your company name"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="mt-1"
                placeholder="Create a password (min 8 characters)"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="mt-1"
                placeholder="Confirm your password"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div>
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isLoading ? 'Creating account...' : 'Create account'}
            </Button>
          </div>

          <div className="text-center">
            <Link
              to="/"
              className="text-sm text-blue-600 hover:text-blue-500"
            >
              ← Back to home
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SignupPage;
