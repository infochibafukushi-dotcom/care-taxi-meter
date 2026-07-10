import { FirebaseError } from 'firebase/app'
import { doc, getDoc, getFirestore } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirebaseApp } from '../lib/firebase'

const functionsRegion = 'asia-northeast1'

export type StaffCompleteDeleteCounts = {
  staffMembers: number
  staffAttendance: number
  workSessions: number
  caseRecords: number
  accountingSales: number
  gpsRoutes: number
  auditLogs: number
  otherLogs: number
  loginAttempts: number
}

export type StaffCompleteDeleteResult = {
  success: boolean
  targetStaffId: string
  targetName: string
  deletedCounts: StaffCompleteDeleteCounts
  warnings?: string[]
  message?: string
}

const toCallableErrorMessage = (error: unknown) => {
  if (error instanceof FirebaseError) {
    return error.message || '従業員の完全削除に失敗しました。'
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return '従業員の完全削除に失敗しました。'
}

export async function isStaffMemberPersisted(staffId: string) {
  const db = getFirestore(getFirebaseApp())
  const snapshot = await getDoc(doc(db, 'staffMembers', staffId))
  return snapshot.exists()
}

export async function deleteStaffMemberCompletely(staffId: string): Promise<StaffCompleteDeleteResult> {
  const functions = getFunctions(getFirebaseApp(), functionsRegion)
  const callable = httpsCallable<{ staffId: string }, StaffCompleteDeleteResult>(
    functions,
    'deleteStaffMemberCompletely',
  )

  try {
    const result = await callable({ staffId })
    return result.data
  } catch (error) {
    throw new Error(toCallableErrorMessage(error))
  }
}

export function formatStaffCompleteDeleteSummary(
  targetName: string,
  deletedCounts: StaffCompleteDeleteCounts,
) {
  const parts = [
    deletedCounts.workSessions > 0 ? `勤務履歴 ${deletedCounts.workSessions}件` : '',
    deletedCounts.caseRecords > 0 ? `運行記録 ${deletedCounts.caseRecords}件` : '',
    deletedCounts.accountingSales > 0 ? `売上記録 ${deletedCounts.accountingSales}件` : '',
  ].filter(Boolean)

  const detail = parts.length > 0 ? `${parts.join('、')}を削除しました。` : '関連データはありませんでした。'
  return `${targetName}を完全削除しました。${detail}PL・売上集計も更新されました。`
}
