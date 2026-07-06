import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cwd = process.argv[2]
if (!cwd) {
  console.error('build cwd is required')
  process.exit(1)
}

const viteBin = join(cwd, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(viteBin)) {
  console.error(`Vite not found: ${viteBin}`)
  process.exit(1)
}

const outDir = process.env.CARE_TAXI_METER_OUT_DIR?.trim() || join(cwd, 'dist')
const result = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd,
  stdio: 'inherit',
  env: process.env,
})

if (existsSync(join(outDir, 'index.html'))) {
  process.exit(0)
}

process.exit(result.status ?? 1)
