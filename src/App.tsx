import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ProjectList } from './components/ProjectList';
import { TakeoffWorkspace } from './components/TakeoffWorkspace';
import LandingPage from './components/LandingPage';
import FeaturesPage from './components/FeaturesPage';
import PricingPage from './components/PricingPage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import AuthGuard from './components/AuthGuard';
import { useTakeoffStore } from './store/useTakeoffStore';

// Component to handle redirect from old /job/ routes to new /project/ routes
function JobRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/project/${projectId}`} replace />;
}

function App() {
  const { loadInitialData } = useTakeoffStore();
  const isDev = import.meta.env.DEV;
  
  useEffect(() => {
    if (isDev) {
      console.log('🚀 APP: App component mounted', { 
        currentUrl: window.location.href,
        pathname: window.location.pathname,
        search: window.location.search
      });
    }
    
    // Load initial data when app starts
    loadInitialData();
  }, [loadInitialData]);

  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
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
              <TakeoffWorkspace />
            </AuthGuard>
          } 
        />
        {/* Redirect old /job/ routes to /project/ routes */}
        <Route 
          path="/job/:projectId" 
          element={<JobRedirect />} 
        />
      </Routes>
    </Router>
  );
}

export default App;
