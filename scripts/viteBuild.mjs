import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
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

const cleanLocalDist = () => {
  const distDir = join(projectRoot, 'dist')
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true })
    console.info('[viteBuild] removed stale dist/')
  }
}

cleanLocalDist()

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
  // PWA / Vite 失敗を dist 残存で成功扱いしない
  process.exit(exitCode)
}

const exitCode = run(process.execPath, [viteRunner, projectRoot], {
  cwd: projectRoot,
  env: {
    ...process.env,
    CARE_TAXI_METER_OUT_DIR: join(projectRoot, 'dist'),
  },
})

process.exit(exitCode)
