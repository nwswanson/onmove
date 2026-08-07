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
const featureRoot = join(rendererRoot, 'features')
const featureFiles = sourceFiles(featureRoot)
const modelFiles = featureFiles.filter((path) => /use-[^/]+-model\.ts$/.test(path))
const viewCompositionFiles = [
  join(rendererRoot, 'App.tsx'),
  join(rendererRoot, 'features/focus/focus-workspace.tsx')
]
const presenterFiles = featureFiles.filter((path) => /-presenters\.ts$/.test(path))
const featureComponentFiles = [
  join(rendererRoot, 'App.tsx'),
  ...featureFiles.filter((path) => extname(path) === '.tsx')
]
const featureReceiverFiles = featureFiles.filter((path) => /update-table\.tsx$/.test(path))

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
    expect(source).not.toMatch(/<ContextDrawer(?:\s|>)/)
  })

  it.each(presenterFiles)('%s remains a non-rendering contract translator', (path) => {
    const source = readFileSync(path, 'utf8')

    expect(extname(path)).toBe('.ts')
    expect(source).not.toMatch(/from ['"]react['"]|ReactNode|JSX\.Element/)
  })

  it.each(featureComponentFiles)('%s cannot bypass the model-driven drawer receiver', (path) => {
    const source = readFileSync(path, 'utf8')

    expect(source).not.toMatch(/<ContextDrawer(?:\s|>)/)
  })

  it.each(featureReceiverFiles)('%s remains business-model and persistence agnostic', (path) => {
    const source = readFileSync(path, 'utf8')

    expect(source).not.toContain('shared/contracts')
    expect(source).not.toContain('window.onmove')
  })

  it('keeps model-driven receiver contracts free of caller render hooks', () => {
    const drawerSource = readFileSync(join(uiRoot, 'context-drawer.tsx'), 'utf8')
    const sidebarSource = readFileSync(join(uiRoot, 'contextual-sidebar.tsx'), 'utf8')
    const adapterContract = drawerSource.slice(
      drawerSource.indexOf('export interface ContextDrawerAdapter'),
      drawerSource.indexOf('export interface ContextDrawerState')
    )

    expect(adapterContract).toContain('model: ContextDrawerModel')
    expect(adapterContract).not.toMatch(/render|ReactNode/)
    expect(sidebarSource).not.toContain('renderItem')
  })
})
