import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const work = mkdtempSync(join(tmpdir(), 'dsh-reasoning-cn-package-'))
let tarball
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json'], { encoding: 'utf8' }))
  const filename = packed[0]?.filename
  if (typeof filename !== 'string') throw new Error('npm pack did not return a tarball filename')
  tarball = join(process.cwd(), filename)
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], {
    cwd: work,
    stdio: 'inherit',
  })
  execFileSync(process.execPath, ['--input-type=module', '-e', "const plugin = await import('dsh-reasoning-cn'); if (plugin.name !== 'dsh-reasoning-cn') throw new Error('unexpected plugin name')"], {
    cwd: work,
    stdio: 'inherit',
  })
  console.log(`[package:check] PASS: ${filename} installs and imports from an empty project`)
} finally {
  if (tarball !== undefined) rmSync(tarball, { force: true })
  rmSync(work, { recursive: true, force: true })
}
