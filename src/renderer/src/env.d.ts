/// <reference types="vite/client" />

import type { OnMoveApi } from '../../shared/contracts'

declare global {
  interface Window {
    onmove: OnMoveApi
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

export {}
