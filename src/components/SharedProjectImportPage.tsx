import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { authHelpers } from '../lib/supabase';
import { projectService } from '../services/apiService';
import { useProjectStore } from '../store/slices/projectSlice';
import { Button } from './ui/button';
import { Loader2, LogIn } from 'lucide-react';

export function SharedProjectImportPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const loadInitialData = useProjectStore((s) => s.loadInitialData);
  const [status, setStatus] = useState<'checking' | 'unauthenticated' | 'importing' | 'error' | 'success'>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Invalid share link');
      return;
    }

    let mounted = true;
    (async () => {
      const user = await authHelpers.getCurrentUser();
      if (!mounted) return;

      if (!user) {
        setStatus('unauthenticated');
        return;
      }

      setStatus('importing');
      try {
        const result = await projectService.importSharedProject(token);
        if (!mounted) return;
        await loadInitialData();
        if (!mounted) return;
        navigate(`/project/${result.project.id}`, { replace: true });
      } catch (err) {
        if (!mounted) return;
        setStatus('error');
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setError(msg || 'This shared project has expired or is invalid.');
      }
    })();
    return () => { mounted = false; };
  }, [token, navigate, loadInitialData]);

  const redirectPath = `/shared/import/${token || ''}`;

  if (status === 'checking' || status === 'importing') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">
            {status === 'checking' ? 'Checking access...' : 'Importing project...'}
          </p>
          {status === 'importing' && (
            <p className="text-sm text-slate-500 mt-2">This may take a minute for large projects.</p>
          )}
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">
            Sign in to access this project
          </h1>
          <p className="text-slate-600">
            A project has been shared with you. Sign in or create an account to import it.
          </p>
          <div className="flex flex-col gap-3">
            <Link to={`/login?redirect=${encodeURIComponent(redirectPath)}`}>
              <Button className="w-full" size="lg">
                <LogIn className="h-4 w-4 mr-2" />
                Sign in
              </Button>
            </Link>
            <p className="text-sm text-slate-500">
              New to Meridian Takeoff? Ask your team admin for an invitation, then sign up.
            </p>
            <Link to="/" className="text-sm text-blue-600 hover:text-blue-500">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">
            Unable to load project
          </h1>
          <p className="text-slate-600">{error}</p>
          <Link to="/app">
            <Button variant="outline">Go to my projects</Button>
          </Link>
          <Link to="/" className="block text-sm text-blue-600 hover:text-blue-500">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
