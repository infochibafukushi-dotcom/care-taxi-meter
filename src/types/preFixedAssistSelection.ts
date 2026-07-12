/** lp-site estimate-config.json categories / mappings 互換の介助選択型 */

export type AssistChoiceStepId = 'mobility' | 'assistance' | 'stair' | 'extras'

export type MobilityAssistanceMode = 'select' | 'required' | 'fixed'

export type AssistCatalogItem = {
  id: string
  label: string
  description: string
  amount: number
  order: number
}

export type MobilityAssistanceRule = {
  mode: MobilityAssistanceMode
  assistanceIds: string[]
  /** fixed モード時の自動選択 ID */
  assistanceId?: string
}

export type PreFixedAssistSelectionState = {
  mobilityId: string
  assistanceId: string
  stairId: string
  /** その他（予約迎車・1BOX 等）複数可 */
  extraIds: string[]
  /** 往復時の待機/付き添い（単一・任意） */
  roundTripAddonId: string
  /** 編集中のステップ。未完了の先頭が active */
  editingStepId: AssistChoiceStepId | null
}

export const createEmptyAssistSelectionState = (): PreFixedAssistSelectionState => ({
  mobilityId: '',
  assistanceId: '',
  stairId: '',
  extraIds: [],
  roundTripAddonId: '',
  editingStepId: 'mobility',
})
