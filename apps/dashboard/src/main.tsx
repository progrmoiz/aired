import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import App from './App'

// Design directions (mock data, no API): /dashboard?direction=a|b
const Directions = lazy(() => import('./directions'))
const direction = new URLSearchParams(window.location.search).has('direction')
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      {direction ? <Suspense fallback={null}><Directions /></Suspense> : <App />}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  </StrictMode>,
)
