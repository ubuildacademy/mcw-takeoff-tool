import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button } from './ui/button';
import { LandingNav } from './LandingNav';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authHelpers } from '../lib/supabase';
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

function getAuthErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/app';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Prefer direct Supabase auth (ensures we're authenticating against the same project
      // as the rest of the frontend). Fall back to proxy only for network/CORS issues.
      const direct = await authHelpers.signIn(email, password);
      let error = direct.error as unknown;

      const isLikelyNetworkOrCors =
        !!direct.error &&
        !!getAuthErrorMessage(direct.error) &&
        /(failed to fetch|network|cors|fetch)/i.test(getAuthErrorMessage(direct.error) ?? '');

      if (direct.error && isLikelyNetworkOrCors) {
        const proxy = await authHelpers.signInViaProxy(email, password);
        error = proxy.error as unknown;
      }

      if (error) {
        setError(getAuthErrorMessage(error) ?? 'An error occurred');
      } else {
        navigate(redirect.startsWith('/') ? redirect : `/${redirect}`, { replace: true });
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={authPageShell}>
      <LandingNav showBackToHome />
      <div className={authCenter}>
        <div className={authCard}>
          <div className="text-center">
            <h2 className={authTitle}>
              Sign in to your account
            </h2>
            <p className={authSubtitle}>
              Access your construction takeoff projects.
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
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authInput}
                placeholder="Enter your email"
              />
            </div>
            <div>
              <Label htmlFor="password" className={authLabel}>Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={authInput}
                placeholder="Enter your password"
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
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </div>

          <div className="text-center">
            <Link
              to="/forgot-password"
              className={authLink}
            >
              Forgot password?
            </Link>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
