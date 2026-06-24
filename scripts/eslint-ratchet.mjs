// [T-P1-422/AC2] eslint error RATCHET: run eslint, sum errorCount, fail iff it EXCEEDS the
// checked-in baseline (.eslint-ratchet.json maxErrors). No-new-errors gate, not a clean bar —
// the repo carries a known error backlog (mostly the 7000-line MapsPage god object) that is being
// burned down task by task; this prevents NEW errors while allowing the backlog to shrink.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(repoRoot, '.eslint-ratchet.json')
const { maxErrors } = JSON.parse(readFileSync(baselinePath, 'utf8'))

// eslint exits non-zero when there are any errors; we parse JSON regardless of exit code.
const res = spawnSync('npx', ['eslint', '.', '-f', 'json'], {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
})

if (res.error) {
  console.error('[eslint-ratchet] failed to run eslint:', res.error.message)
  process.exit(2)
}

let report
try {
  report = JSON.parse(res.stdout)
} catch {
  console.error('[eslint-ratchet] could not parse eslint JSON output. stderr:\n', res.stderr)
  process.exit(2)
}

const errorCount = report.reduce((sum, file) => sum + file.errorCount, 0)
const warningCount = report.reduce((sum, file) => sum + file.warningCount, 0)

console.log(`[eslint-ratchet] errors=${errorCount} (baseline maxErrors=${maxErrors}), warnings=${warningCount}`)

if (errorCount > maxErrors) {
  console.error(
    `[eslint-ratchet] FAIL: ${errorCount} errors exceeds baseline ${maxErrors}. ` +
      `Fix the new errors, or if you intentionally reduced the count, lower maxErrors in .eslint-ratchet.json.`,
  )
  process.exit(1)
}

if (errorCount < maxErrors) {
  console.warn(
    `[eslint-ratchet] NOTE: ${errorCount} < baseline ${maxErrors}. ` +
      `You cleared errors — please lower maxErrors in .eslint-ratchet.json to ${errorCount} to ratchet the gate down.`,
  )
}

console.log('[eslint-ratchet] PASS')
process.exit(0)
