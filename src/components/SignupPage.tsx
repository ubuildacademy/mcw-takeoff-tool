import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authHelpers } from '../lib/supabase';
import { authService } from '../services/apiService';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../utils/passwordValidation';
import { LandingNav } from './LandingNav';
import {
  authCard,
  authCenter,
  authDisabledInput,
  authInput,
  authLabel,
  authLink,
  authPageShell,
  authSubtitle,
  authTitle,
} from './authPageStyles';

/** Minimal invitation shape for signup form (from API validation) */
interface InvitationInfo {
  email: string;
  role: string;
}

const SignupPage: React.FC = () => {
  const { inviteToken } = useParams<{ inviteToken: string }>();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/app';
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

    const passwordCheck = validatePassword(formData.password);
    if (!passwordCheck.valid) {
      setError(passwordCheck.error);
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
      const { data: _signUpData, error: signUpError } = await authHelpers.signUp(
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

      navigate(redirect.startsWith('/') ? redirect : `/${redirect}`, { replace: true });
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className={authPageShell}>
        <LandingNav showBackToHome />
        <div className={authCenter}>
          <div className={`${authCard} text-center`}>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-3 text-slate-600">Validating invitation...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className={authPageShell}>
        <LandingNav showBackToHome />
        <div className={authCenter}>
          <div className={`${authCard} text-center`}>
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-red-600">{error}</p>
            </div>
            <Link
              to="/"
              className={`${authLink} mt-4 inline-block`}
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={authPageShell}>
      <LandingNav showBackToHome />
      <div className={authCenter}>
        <div className={authCard}>
          <div className="text-center">
            <h2 className={authTitle}>
              Complete your account setup
            </h2>
            <p className={authSubtitle}>
              You've been invited to join as a {invitation.role}
            </p>
          </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email" className={authLabel}>Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={invitation.email}
                disabled
                className={authDisabledInput}
              />
            </div>
            <div>
              <Label htmlFor="fullName" className={authLabel}>Full Name</Label>
              <Input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className={authInput}
                placeholder="Enter your full name"
              />
            </div>
            <div>
              <Label htmlFor="company" className={authLabel}>Company (Optional)</Label>
              <Input
                id="company"
                name="company"
                type="text"
                autoComplete="organization"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className={authInput}
                placeholder="Enter your company name"
              />
            </div>
            <div>
              <Label htmlFor="password" className={authLabel}>Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={authInput}
                placeholder={PASSWORD_REQUIREMENTS}
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword" className={authLabel}>Confirm Password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className={authInput}
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
              to="/login"
              className={authLink}
            >
              Already have an account? Sign in
            </Link>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
