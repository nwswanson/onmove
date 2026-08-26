import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  build?: {
    directories?: { buildResources?: string }
    extraResources?: Array<{ from?: string; to?: string }>
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

  it('ships the pinned semantic model as an immutable application resource', () => {
    const projectRoot = process.cwd()
    const manifest = JSON.parse(
      readFileSync(resolve(projectRoot, 'package.json'), 'utf8')
    ) as PackageManifest
    const modelResource = manifest.build?.extraResources?.find(
      ({ to }) => to === 'models/universal-sentence-encoder-lite-v1'
    )

    expect(modelResource?.from).toBe('resources/models/universal-sentence-encoder-lite-v1')
    const assets = JSON.parse(
      readFileSync(resolve(projectRoot, modelResource?.from ?? '', 'ASSETS.json'), 'utf8')
    ) as {
      modelId?: string
      files?: Array<{ name: string; size: number; sha256: string }>
    }
    expect(assets.modelId).toBe('universal-sentence-encoder-lite:1')
    expect(assets.files).toHaveLength(9)
    expect(assets.files?.reduce((total, file) => total + file.size, 0)).toBe(28_369_009)
    expect(assets.files?.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true)
    for (const file of assets.files ?? []) {
      const contents = readFileSync(resolve(projectRoot, modelResource?.from ?? '', file.name))
      expect(contents.byteLength, file.name).toBe(file.size)
      expect(createHash('sha256').update(contents).digest('hex'), file.name).toBe(file.sha256)
    }
  })
})
