import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

const rendererRoot = resolve('src/renderer/src')
const uiRoot = join(rendererRoot, 'components/ui')
const modelFiles = [
  join(rendererRoot, 'features/application/use-application-model.ts'),
  join(rendererRoot, 'features/focus/use-focus-workspace-model.ts')
]
const viewCompositionFiles = [
  join(rendererRoot, 'App.tsx'),
  join(rendererRoot, 'features/focus/focus-workspace.tsx')
]

describe('renderer architecture boundaries', () => {
  it.each(sourceFiles(uiRoot))('%s remains domain and persistence agnostic', (path) => {
    const source = readFileSync(path, 'utf8')

    expect(source).not.toContain('window.onmove')
    expect(source).not.toMatch(/(?:shared\/contracts|@\/features\/|\/main\/|\/preload\/)/)
  })

  it.each(modelFiles)('%s does not import UI components', (path) => {
    const source = readFileSync(path, 'utf8')

    expect(source).not.toContain('@/components/ui')
  })

  it.each(viewCompositionFiles)('%s keeps direct preload access out of view composition', (path) => {
    const source = readFileSync(path, 'utf8')

    expect(source).not.toContain('window.onmove')
  })
})
