import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startEvents } from './lib'
import './styles.css'

// ?static skips live updates (they keep a connection open forever, which headless screenshot tools wait on)
if (!new URLSearchParams(location.search).has('static')) startEvents()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // installable without it in current Edge and Chrome; the offline page is a nicety
  })
}
