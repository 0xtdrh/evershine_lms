import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// C15 (final test 23/11): the app's built-in browser and installed apps block window.confirm — buttons that asked first
// did nothing. Every question goes through ask() from components/ui/confirm-dialog.tsx.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : []
  })
}

describe('no browser confirm() in screens (C15)', () => {
  it('every confirmation uses ask()', () => {
    const bad = [...files('app'), ...files('components')]
      .filter((f) => !f.split('\\').join('/').endsWith('components/ui/confirm-dialog.tsx'))
      .filter((f) => /(window\.confirm\(|(?<![\w.$])confirm\()/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')))
    expect(bad).toEqual([])
  })
})
