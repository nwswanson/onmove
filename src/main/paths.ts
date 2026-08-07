import { join } from 'node:path'

export function resolveDatabasePath(userDataPath: string): string {
  return join(userDataPath, 'onmove.sqlite3')
}
