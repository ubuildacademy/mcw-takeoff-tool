import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from './ui/button';
import { LandingNav } from './LandingNav';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authHelpers, supabase } from '../lib/supabase';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../utils/passwordValidation';
import {
  authCard,
  authCenter,
  authInput,
  authLabel,
  authLink,
  authPageShell,
  authSubtitle,
  authTitle,
} from './authPageStyles';

/**
 * Landing page when user clicks "Reset Password" in the email.
 * Supabase redirects here with session in the URL hash; the client recovers it automatically.
 * We show a form for them to set their new password.
 */
const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    // Supabase auto-processes hash on load. Check if we have a session (recovery flow).
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setHasSession(!!session);
    };
    checkSession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      setError(passwordCheck.error);
      return;
    }
    setIsLoading(true);
    try {
      await authHelpers.updatePassword(password);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setIsLoading(false);
    }
  };

  if (hasSession === null) {
    return (
      <div className={authPageShell}>
        <LandingNav showBackToHome />
        <div className={authCenter}>
          <div className={`${authCard} text-center`}>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-3 text-slate-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (hasSession === false) {
    return (
      <div className={authPageShell}>
        <LandingNav showBackToHome />
        <div className={authCenter}>
          <div className={`${authCard} text-center`}>
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
              <p className="text-amber-800">This link has expired or has already been used. Please request a new password reset.</p>
            </div>
            <Link to="/login" className={`${authLink} mt-4 inline-block`}>
              Back to login
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
              Set your new password
            </h2>
            <p className={authSubtitle}>
              Enter your new password below. {PASSWORD_REQUIREMENTS}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="password" className={authLabel}>New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={PASSWORD_REQUIREMENTS}
                className={authInput}
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword" className={authLabel}>Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className={authInput}
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isLoading ? 'Updating...' : 'Update password'}
          </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
