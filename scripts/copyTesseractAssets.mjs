import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(scriptDir, '..')
const destRoot = join(projectRoot, 'public', 'tesseract')
const destCore = join(destRoot, 'core')
const destLang = join(destRoot, 'lang')

const langFiles = [
  {
    url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz',
    fileName: 'jpn.traineddata.gz',
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    fileName: 'eng.traineddata.gz',
  },
]

const main = async () => {
  await mkdir(destCore, { recursive: true })
  await mkdir(destLang, { recursive: true })

  const workerSource = join(projectRoot, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
  const coreDir = join(projectRoot, 'node_modules', 'tesseract.js-core')

  await cp(workerSource, join(destRoot, 'worker.min.js'))
  await cp(join(coreDir, 'tesseract-core-simd-lstm.wasm.js'), join(destCore, 'tesseract-core-simd-lstm.wasm.js'))
  await cp(join(coreDir, 'tesseract-core-simd-lstm.wasm'), join(destCore, 'tesseract-core-simd-lstm.wasm'))
  await cp(
    join(coreDir, 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    join(destCore, 'tesseract-core-relaxedsimd-lstm.wasm.js'),
  )
  await cp(
    join(coreDir, 'tesseract-core-relaxedsimd-lstm.wasm'),
    join(destCore, 'tesseract-core-relaxedsimd-lstm.wasm'),
  )

  for (const langFile of langFiles) {
    const response = await fetch(langFile.url)
    if (!response.ok) {
      throw new Error(`Failed to download ${langFile.url} (${response.status})`)
    }

    await writeFile(join(destLang, langFile.fileName), Buffer.from(await response.arrayBuffer()))
  }

  const requiredFiles = [
    join(destRoot, 'worker.min.js'),
    join(destCore, 'tesseract-core-simd-lstm.wasm.js'),
    join(destCore, 'tesseract-core-simd-lstm.wasm'),
    join(destLang, 'jpn.traineddata.gz'),
    join(destLang, 'eng.traineddata.gz'),
  ]

  for (const filePath of requiredFiles) {
    await stat(filePath)
  }

  console.info('[copyTesseractAssets] copied OCR assets to public/tesseract')
}

main().catch((error) => {
  console.error('[copyTesseractAssets] failed', error)
  process.exit(1)
})
