import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ProjectList } from './components/ProjectList';
import { TakeoffWorkspace } from './components/TakeoffWorkspace';
import { useTakeoffStore } from './store/useTakeoffStore';

function App() {
  const { loadInitialData } = useTakeoffStore();
  
  useEffect(() => {
    // Load initial data when app starts
    loadInitialData();
  }, [loadInitialData]);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/job/:jobId" element={<TakeoffWorkspace />} />
      </Routes>
    </Router>
  );
}

export default App;
