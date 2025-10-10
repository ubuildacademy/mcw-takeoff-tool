import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ProjectList } from './components/ProjectList';
import { TakeoffWorkspace } from './components/TakeoffWorkspace';
import LandingPage from './components/LandingPage';
import FeaturesPage from './components/FeaturesPage';
import PricingPage from './components/PricingPage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import AuthGuard from './components/AuthGuard';
import { useTakeoffStore } from './store/useTakeoffStore';

function App() {
  const { loadInitialData } = useTakeoffStore();
  
  useEffect(() => {
    console.log('🚀 APP: App component mounted', { 
      currentUrl: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search
    });
    
    // Load initial data when app starts
    loadInitialData();
  }, [loadInitialData]);

  return (
    <Router>
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
          path="/job/:jobId" 
          element={
            <AuthGuard>
              <TakeoffWorkspace />
            </AuthGuard>
          } 
        />
      </Routes>
    </Router>
  );
}

export default App;
