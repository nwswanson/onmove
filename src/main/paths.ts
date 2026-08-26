import { join } from 'node:path'

export const BUNDLED_SEMANTIC_MODEL_DIRECTORY =
  'universal-sentence-encoder-lite-v1'

export function resolveDatabasePath(userDataPath: string): string {
  return join(userDataPath, 'onmove.sqlite3')
}

/** Resolves immutable model assets in either the source tree or packaged Resources. */
export function resolveBundledSemanticModelPath(
  appPath: string,
  resourcesPath: string,
  isPackaged: boolean
): string {
  return isPackaged
    ? join(resourcesPath, 'models', BUNDLED_SEMANTIC_MODEL_DIRECTORY)
    : join(appPath, 'resources', 'models', BUNDLED_SEMANTIC_MODEL_DIRECTORY)
}
