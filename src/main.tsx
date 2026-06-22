import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initConsoleCapture } from './lib/consoleLogs'
import { applyThemeMode, readStoredThemeMode } from './lib/theme'

initConsoleCapture()
applyThemeMode(readStoredThemeMode())

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
