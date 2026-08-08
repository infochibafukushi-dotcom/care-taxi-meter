export const buildLegalMasterStoragePath = (params: {
  franchiseeId: string
  storeId: string
  receiptId: string
  version?: number
}) => {
  const version = params.version ?? 1
  return `accounting/${params.franchiseeId}/${params.storeId}/receipts/${params.receiptId}/legal/v${version}/master.jpg`
}

export const buildLegalThumbnailStoragePath = (params: {
  franchiseeId: string
  storeId: string
  receiptId: string
  version?: number
  thumbExt?: 'webp' | 'jpg'
}) => {
  const version = params.version ?? 1
  const ext = params.thumbExt ?? 'webp'
  return `accounting/${params.franchiseeId}/${params.storeId}/receipts/${params.receiptId}/legal/v${version}/thumb.${ext}`
}

export const buildLegalTimestampTokenStoragePath = (params: {
  franchiseeId: string
  storeId: string
  receiptId: string
  version?: number
}) => {
  const version = params.version ?? 1
  return `accounting/${params.franchiseeId}/${params.storeId}/receipts/${params.receiptId}/legal/v${version}/timestamp.tsr`
}
