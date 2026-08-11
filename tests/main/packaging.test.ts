import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  build?: {
    directories?: { buildResources?: string }
    mac?: { icon?: string }
  }
}

describe('macOS packaging assets', () => {
  it('uses the tracked scalable icon source from the build-resources directory', () => {
    const projectRoot = process.cwd()
    const manifest = JSON.parse(
      readFileSync(resolve(projectRoot, 'package.json'), 'utf8')
    ) as PackageManifest

    expect(manifest.build?.directories?.buildResources).toBe('build')
    const iconPath = manifest.build?.mac?.icon
    expect(iconPath).toBe('build/icon.svg')
    if (!iconPath) throw new Error('macOS icon path is required')

    const icon = readFileSync(resolve(projectRoot, iconPath), 'utf8')
    expect(icon).toContain('<svg')
    expect(icon).toContain('viewBox="0 0 1024 1024"')
  })
})
