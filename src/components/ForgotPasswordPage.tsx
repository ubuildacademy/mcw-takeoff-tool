import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from './ui/button';
import { LandingNav } from './LandingNav';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authHelpers } from '../lib/supabase';

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const { error } = await authHelpers.resetPassword(email);
      if (error) {
        setError((error as { message?: string })?.message ?? 'Something went wrong');
      } else {
        setSent(true);
      }
    } catch {
      setError('Failed to send reset email');
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
        <LandingNav showBackToHome />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center">
            <div className="mt-6 bg-green-50 border border-green-200 rounded-md p-4">
              <p className="text-green-800">Check your email for a link to reset your password.</p>
            </div>
            <Link to="/login" className="mt-4 inline-block text-blue-600 hover:text-blue-500">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">
      <LandingNav showBackToHome />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-slate-700">
              Reset your password
            </h2>
            <p className="mt-2 text-sm text-slate-600">
                Enter your email and we&apos;ll send you a link to reset your password.
            </p>
          </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
            />
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
            {isLoading ? 'Sending...' : 'Send reset link'}
          </Button>
        </form>

        <div className="text-center">
          <Link to="/login" className="text-sm text-blue-600 hover:text-blue-500">
            ← Back to login
          </Link>
        </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
