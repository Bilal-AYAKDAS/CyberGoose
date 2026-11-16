import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { configureApi } from './services/apiClient'

// Electron'da başlık çubuğu yerleşimi platforma göre değişir (macOS trafik ışıkları / Windows overlay).
document.documentElement.dataset.platform = window.cyberGoose?.platform ?? 'web'

/** Açılış ekranı en az bu kadar görünür; animasyon yarıda kesilmesin. */
const SPLASH_MIN_MS = 900
const splashStart = performance.now()

function setSplashStatus(text: string, retry?: () => void) {
  const status = document.getElementById('cg-splash-status')
  if (!status) return
  status.textContent = text
  status.classList.toggle('is-error', Boolean(retry))
  if (retry) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 's-retry'
    button.textContent = 'Yeniden dene'
    button.addEventListener('click', retry, { once: true })
    status.append(document.createElement('br'), button)
  }
}

function hideSplash() {
  const splash = document.getElementById('cg-splash')
  if (!splash || splash.classList.contains('is-done')) return
  const wait = Math.max(0, SPLASH_MIN_MS - (performance.now() - splashStart))
  window.setTimeout(() => {
    splash.classList.add('is-done')
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    window.setTimeout(() => splash.remove(), 600)
  }, wait)
}

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App onReady={hideSplash} />
    </StrictMode>,
  )
}

/** Masaüstünde önce yerel API'nin açılmasını bekler; hata olursa açılış ekranında gösterir. */
async function start() {
  const backend = window.cyberGoose?.backend
  if (!backend) {
    render()
    return
  }
  setSplashStatus('Yerel sunucu başlatılıyor')
  try {
    const { base, token } = await backend()
    if (base) configureApi(base, token)
    setSplashStatus('')
    render()
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error)
    setSplashStatus(`Yerel sunucu başlatılamadı: ${message}`, () => { void start() })
  }
}

void start()
