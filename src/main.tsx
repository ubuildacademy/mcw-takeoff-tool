import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { migrateLocalStorageMeasurements, cleanupFabricData } from './utils/migrationUtils'

// Run migration on app startup
console.log('Running Fabric.js to PDF.js migration...');
migrateLocalStorageMeasurements();
cleanupFabricData();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
