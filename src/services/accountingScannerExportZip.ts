import { getBytes, getStorage, ref } from 'firebase/storage'
import { getFirebaseApp } from '../lib/firebase'
import type { StoredAccountingReceipt } from '../types/accounting'
import {
  buildScannerReceiptExportCsv,
  buildScannerReceiptExportFileName,
} from '../utils/accountingScannerExport'
import { isReviewDemoRuntimeEnabled } from '../utils/reviewDemo'
import type { AuditActor } from './auditLogs'
import { recordScannerAuditEvent } from './accountingScannerAudit'
import { fetchScannerReceiptVersions } from './accountingReceiptLegalLifecycle'

const CSV_EOL = '\r\n'
const UTF8_BOM = '\uFEFF'

const escapeCsv = (value: string | number | null | undefined) => {
  if (value == null) {
    return ''
  }
  const stringValue = String(value)
  if (!/[",\n\r]/.test(stringValue)) {
    return stringValue
  }
  return `"${stringValue.replaceAll('"', '""')}"`
}

const historyHeaders = [
  'receiptId',
  'version',
  'event',
  'changedAt',
  'changedBy',
  'changeReason',
  'deletedAt',
  'deletedBy',
  'deleteReason',
  'timestampStatus',
  'fileHash',
] as const

/**
 * 税務調査用 ZIP（index.csv + masters + timestamps + audit/history.csv）
 */
export async function buildScannerLegalExportZip(input: {
  receipts: StoredAccountingReceipt[]
  actor?: AuditActor | null
}): Promise<{ blob: Blob; fileName: string }> {
  if (isReviewDemoRuntimeEnabled()) {
    throw new Error('デモモードでは税務ZIPを出力できません。')
  }

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const storage = getStorage(getFirebaseApp())
  const exportedAt = new Date().toISOString()

  const indexCsv = buildScannerReceiptExportCsv(input.receipts)
  zip.file('index.csv', indexCsv)

  const historyLines = [historyHeaders.join(',')]

  for (const receipt of input.receipts) {
    const versions = await fetchScannerReceiptVersions(receipt.id)
    const versionList =
      versions.length > 0
        ? versions
        : [
            {
              version: receipt.activeVersion || receipt.version || 1,
              legalMasterStoragePath: receipt.legalMasterStoragePath || '',
              timestampTokenStoragePath: receipt.timestampTokenStoragePath || '',
              fileHash: receipt.fileHash || '',
              timestampStatus: receipt.timestampStatus || 'none',
              changeReason: receipt.changeReason,
              createdAt: receipt.changedAt || receipt.capturedAt,
              createdBy: receipt.changedBy || receipt.uploadedBy,
            },
          ]

    for (const version of versionList) {
      const versionNumber = version.version
      const masterPath = version.legalMasterStoragePath
      if (masterPath) {
        try {
          const bytes = await getBytes(ref(storage, masterPath))
          zip.file(`receipts/${receipt.id}_v${versionNumber}.jpg`, bytes)
        } catch {
          // 欠損は index 側で追えるように履歴へ残す
          historyLines.push(
            [
              receipt.id,
              versionNumber,
              'master_missing',
              '',
              '',
              masterPath,
              '',
              '',
              '',
              version.timestampStatus || '',
              version.fileHash || '',
            ]
              .map(escapeCsv)
              .join(','),
          )
        }
      }

      const tokenPath = version.timestampTokenStoragePath
      if (tokenPath) {
        try {
          const tokenBytes = await getBytes(ref(storage, tokenPath))
          zip.file(`timestamps/${receipt.id}_v${versionNumber}.tsr`, tokenBytes)
        } catch {
          historyLines.push(
            [
              receipt.id,
              versionNumber,
              'timestamp_token_missing',
              '',
              '',
              tokenPath,
              '',
              '',
              '',
              version.timestampStatus || '',
              version.fileHash || '',
            ]
              .map(escapeCsv)
              .join(','),
          )
        }
      }

      historyLines.push(
        [
          receipt.id,
          versionNumber,
          'version',
          version.createdAt || receipt.changedAt || '',
          version.createdBy || receipt.changedBy || '',
          version.changeReason || receipt.changeReason || '',
          receipt.deletedAt || '',
          receipt.deletedBy || '',
          receipt.deleteReason || '',
          version.timestampStatus || '',
          version.fileHash || '',
        ]
          .map(escapeCsv)
          .join(','),
      )
    }

    await recordScannerAuditEvent({
      eventType: 'exported',
      receiptId: receipt.id,
      version: receipt.activeVersion || receipt.version,
      actor: input.actor,
      franchiseeId: receipt.franchiseeId,
      storeId: receipt.storeId,
      metadata: { exportedAt },
    })
  }

  zip.file('audit/history.csv', `${UTF8_BOM}${historyLines.join(CSV_EOL)}${CSV_EOL}`)

  const blob = await zip.generateAsync({ type: 'blob' })
  const fileName = buildScannerReceiptExportFileName(exportedAt).replace(/\.csv$/i, '.zip')
  return { blob, fileName }
}
