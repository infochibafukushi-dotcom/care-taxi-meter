import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const viteRunner = join(scriptDir, 'viteBuildRunner.mjs')
const windowsBuildScript = join(scriptDir, 'build-windows.cmd')

const hasNonAsciiPath = (value) => /[^\u0000-\u007F]/.test(value)

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  return result.status ?? 1
}

const shouldUseWindowsCmdBuild =
  process.env.VITE_FORCE_LOCAL_BUILD === '1'
    ? false
    : process.platform === 'win32' && hasNonAsciiPath(projectRoot)

if (shouldUseWindowsCmdBuild) {
  console.info(
    '[viteBuild] Windows の非ASCIIパスを検出したため、build-windows.cmd で production build を実行します。',
  )
  console.info(`[viteBuild] projectRoot: ${projectRoot}`)

  const exitCode = run('cmd.exe', ['/d', '/s', '/c', windowsBuildScript])
  if (existsSync(join(projectRoot, 'dist', 'index.html'))) {
    process.exit(0)
  }
  process.exit(exitCode)
}

const exitCode = run(process.execPath, [viteRunner, projectRoot], {
  cwd: projectRoot,
  env: {
    ...process.env,
    CARE_TAXI_METER_OUT_DIR: join(projectRoot, 'dist'),
  },
})

if (existsSync(join(projectRoot, 'dist', 'index.html'))) {
  process.exit(0)
}

process.exit(exitCode)
