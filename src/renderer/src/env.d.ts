/// <reference types="vite/client" />

import type { OnMoveApi } from '../../shared/contracts'

declare global {
  interface Window {
    onmove: OnMoveApi
  }
}

export {}
