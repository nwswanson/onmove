import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RichTextDocumentWindow } from './features/rich-text/rich-text-document-window'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

void window.onmove.richText.getWindowTarget().then(
  (target) => root.render(
    <StrictMode>
      {target ? <RichTextDocumentWindow reference={target} /> : <App />}
    </StrictMode>
  ),
  () => root.render(<StrictMode><App /></StrictMode>)
)
