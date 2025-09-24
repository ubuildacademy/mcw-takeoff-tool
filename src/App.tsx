import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ProjectList } from './components/ProjectList';
import { TakeoffWorkspace } from './components/TakeoffWorkspace';
import LandingPage from './components/LandingPage';
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
        <Route path="/app" element={<ProjectList />} />
        <Route path="/job/:jobId" element={<TakeoffWorkspace />} />
      </Routes>
    </Router>
  );
}

export default App;
