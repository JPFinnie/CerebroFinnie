import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DocsPage from './pages/DocsPage.tsx'

const normalizedPathname = window.location.pathname.replace(/\/+$/, '') || '/'
const isDocsRoute = normalizedPathname === '/docs'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDocsRoute ? <DocsPage /> : <App />}
  </StrictMode>,
)
