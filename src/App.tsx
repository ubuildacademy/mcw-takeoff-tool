import { useEffect, lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import AuthGuard from './components/AuthGuard';
import ErrorBoundary from './components/ErrorBoundary';
import { useProjectStore } from './store/slices/projectSlice';
import { runStoreMigration } from './store/migrateStores';

// Route-level code splitting: heavy app routes load on demand
const ProjectList = lazy(() => import('./components/ProjectList').then(m => ({ default: m.ProjectList })));
const TakeoffWorkspace = lazy(() => import('./components/TakeoffWorkspace').then(m => ({ default: m.TakeoffWorkspace })));
const LandingPage = lazy(() => import('./components/LandingPage'));
const FeaturesPage = lazy(() => import('./components/FeaturesPage'));
const PricingPage = lazy(() => import('./components/PricingPage'));
const LoginPage = lazy(() => import('./components/LoginPage'));
const SignupPage = lazy(() => import('./components/SignupPage'));

// Component to handle redirect from old /job/ routes to new /project/ routes
function JobRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/project/${projectId}`} replace />;
}

function App() {
  const loadInitialData = useProjectStore((s) => s.loadInitialData);
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    runStoreMigration();
  }, []);

  useEffect(() => {
    if (isDev) {
      console.log('🚀 APP: App component mounted', {
        currentUrl: window.location.href,
        pathname: window.location.pathname,
        search: window.location.search
      });
    }
    loadInitialData();
  }, [loadInitialData, isDev]);

  return (
    <>
    <Toaster richColors position="top-center" />
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground animate-pulse">Loading…</div>
      }>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup/:inviteToken" element={<SignupPage />} />
          <Route 
            path="/app" 
            element={
              <AuthGuard>
                <ProjectList />
              </AuthGuard>
            } 
          />
          <Route 
            path="/project/:projectId" 
            element={
              <AuthGuard>
                <ErrorBoundary>
                  <TakeoffWorkspace />
                </ErrorBoundary>
              </AuthGuard>
            } 
          />
          {/* Redirect old /job/ routes to /project/ routes */}
          <Route 
            path="/job/:projectId" 
            element={<JobRedirect />} 
          />
        </Routes>
      </Suspense>
    </Router>
    </>
  );
}

export default App;
