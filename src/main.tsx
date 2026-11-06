import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { getDataStore } from './data/generate'
import './index.css'

// Eager synthetic store so first route paint does not wait on generation
getDataStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
