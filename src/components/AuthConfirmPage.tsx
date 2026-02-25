import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * Handles Supabase email confirmation links (signup confirm + password reset).
 * URL format: /auth/confirm?token_hash=...&type=email (or type=recovery)
 */
const AuthConfirmPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type') as 'email' | 'recovery' | undefined;

    if (!tokenHash || !type) {
      setStatus('error');
      setErrorMessage('Invalid confirmation link. Missing token or type.');
      return;
    }

    (async () => {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });

      if (error) {
        setStatus('error');
        setErrorMessage(error.message);
        return;
      }

      setStatus('success');
      navigate('/app', { replace: true });
    })();
  }, [searchParams, navigate]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-2 text-slate-600">Confirming your email...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">
            Meridian <span className="text-blue-600">Takeoff</span>
          </h1>
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-red-600">{errorMessage}</p>
          </div>
          <Link to="/" className="mt-4 inline-block text-blue-600 hover:text-blue-500">
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  return null; // success: navigate will run
};

export default AuthConfirmPage;
