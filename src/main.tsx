import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import { initAutoHideScrollbars } from './utils/autoHideScrollbars'

initAutoHideScrollbars()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The floor under everything. Each app pane has its own boundary, so this
        one only catches what happens outside them — auth, routing, chrome —
        where an uncaught error would otherwise blank the page with no
        explanation and no way back but a manual refresh. */}
    <AppErrorBoundary className="min-h-dvh">
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
