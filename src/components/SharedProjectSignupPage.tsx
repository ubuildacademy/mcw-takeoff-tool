import React, { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authHelpers } from '../lib/supabase';
import { authService } from '../services/apiService';
import { validatePassword, PASSWORD_REQUIREMENTS } from '../utils/passwordValidation';
import { LandingNav } from './LandingNav';

/** Signup for users who received a shared project link. Always creates account with role: user. */
export function SharedProjectSignupPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    email: '',
    fullName: '',
    company: '',
    password: '',
    confirmPassword: '',
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
        <LandingNav showBackToHome />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center">
            <p className="text-red-600">Invalid share link</p>
            <Link to="/" className="mt-4 inline-block text-blue-600 hover:text-blue-500">
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const redirectPath = `/shared/import/${token}`;

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

    try {
      let hasSession = false;

      const { error: signUpError } = await authHelpers.signUp(
        formData.email.trim().toLowerCase(),
        formData.password,
        {
          full_name: formData.fullName.trim() || undefined,
          company: formData.company.trim() || undefined,
        }
      );

      if (signUpError) {
        if (
          signUpError.message?.toLowerCase().includes('already been registered') ||
          signUpError.message?.toLowerCase().includes('already registered') ||
          signUpError.message?.toLowerCase().includes('already exists')
        ) {
          const { error: signInError } = await authHelpers.signInViaProxy(
            formData.email.trim().toLowerCase(),
            formData.password
          );
          if (!signInError) hasSession = true;
        }
        if (!hasSession) {
          setError(signUpError.message);
          setIsLoading(false);
          return;
        }
      } else {
        hasSession = !!(await authHelpers.getCurrentUser());
        if (!hasSession) {
          setError(
            'Please check your email to confirm your account. After confirming, return to this page and sign in to import the project.'
          );
          setIsLoading(false);
          return;
        }
      }

      await authService.completeSharedSignup({
        full_name: formData.fullName.trim() || undefined,
        company: formData.company.trim() || undefined,
      });

      navigate(redirectPath, { replace: true });
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <LandingNav showBackToHome />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-slate-700">
              Create an account to import this project
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              A project has been shared with you. Create a free account to import and work with it.
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
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="mt-1"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="mt-1"
                  placeholder="Enter your full name"
                />
              </div>
              <div>
                <Label htmlFor="company">Company (optional)</Label>
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
                  placeholder={PASSWORD_REQUIREMENTS}
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

            <div className="text-center space-y-2">
              <Link
                to={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                className="block text-sm text-blue-600 hover:text-blue-500"
              >
                Already have an account? Sign in
              </Link>
              <Link to={`/shared/import/${token}`} className="block text-sm text-slate-500 hover:text-slate-600">
                ← Back to project
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
