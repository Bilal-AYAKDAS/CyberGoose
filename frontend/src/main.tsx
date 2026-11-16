import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Electron'da başlık çubuğu yerleşimi platforma göre değişir (macOS trafik ışıkları / Windows overlay).
document.documentElement.dataset.platform = window.cyberGoose?.platform ?? 'web'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
