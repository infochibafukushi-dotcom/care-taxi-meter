/**
 * lp-site「かんたん見積」介助ステップのルール移植。
 * 正本: lp-site/data/estimate-config.json categories + mappings.mobilityAssistance
 * および estimate-main.js clearStepsAfter / openStepForEdit、estimate-calc.js resolveAssistanceId
 */

import type { AssistItem } from './fare'
import type {
  AssistCatalogItem,
  AssistChoiceStepId,
  MobilityAssistanceRule,
  PreFixedAssistSelectionState,
} from '../types/preFixedAssistSelection'
import { createEmptyAssistSelectionState } from '../types/preFixedAssistSelection'
import type { PreFixedRouteCandidate } from '../types/preFixedMeterSession'

/** estimate-config.json categories.mobility */
export const MOBILITY_CATALOG: AssistCatalogItem[] = [
  {
    id: 'free-wheelchair',
    label: '無料車いす',
    description: '当社の標準車いすを無料でご利用いただけます。',
    amount: 0,
    order: 1,
  },
  {
    id: 'own-wheelchair',
    label: 'ご自身の車いす',
    description: '普段ご利用されている車いすのままご乗車いただけます。',
    amount: 0,
    order: 2,
  },
  {
    id: 'reclining-wheelchair',
    label: 'リクライニング車いす',
    description: '長時間の移動や座位保持が難しい方向けのリクライニング式車いすです。',
    amount: 2500,
    order: 3,
  },
  {
    id: 'stretcher',
    label: 'ストレッチャー',
    description: '寝たままの状態で搬送できる設備です。座ることが難しい方に対応します。',
    amount: 4000,
    order: 4,
  },
  {
    id: 'cane-walk',
    label: '杖・歩行器',
    description: '杖や歩行器での移動に対応します。',
    amount: 0,
    order: 5,
  },
]

/** estimate-config.json categories.assistance */
export const ASSISTANCE_CATALOG: AssistCatalogItem[] = [
  {
    id: 'watch-assist',
    label: '見守り介助',
    description: '転倒防止のため付き添いながら移動を見守ります。',
    amount: 0,
    order: 1,
  },
  {
    id: 'boarding-assist',
    label: '乗降介助',
    description: '車いす固定やリフト操作、車への乗り降りをお手伝いします。',
    amount: 1100,
    order: 2,
  },
  {
    id: 'body-assist',
    label: '身体介助',
    description:
      'お部屋から車いすへの移乗介助、車両への乗降介助、車いす固定などを行います。',
    amount: 1600,
    order: 3,
  },
]

/** estimate-config.json categories.stairAssist（label は本番どおり「5階移動」） */
export const STAIR_CATALOG: AssistCatalogItem[] = [
  { id: 'stair-none', label: '階段介助なし', description: '', amount: 0, order: 1 },
  {
    id: 'stair-watch',
    label: '見守り介助',
    description:
      '階段や移動時に転倒防止のため付き添い、安全確認を行います。身体を支える介助は含みません。',
    amount: 0,
    order: 2,
  },
  {
    id: 'stair-floor2',
    label: '2階移動',
    description:
      'エレベーターのない建物などで、階段を利用して移動する際の介助です。階数や介助人数により料金が異なります。',
    amount: 3000,
    order: 3,
  },
  {
    id: 'stair-floor3',
    label: '3階移動',
    description:
      'エレベーターのない建物などで、階段を利用して移動する際の介助です。階数や介助人数により料金が異なります。',
    amount: 5000,
    order: 4,
  },
  {
    id: 'stair-floor4',
    label: '4階移動',
    description:
      'エレベーターのない建物などで、階段を利用して移動する際の介助です。階数や介助人数により料金が異なります。',
    amount: 7000,
    order: 5,
  },
  {
    id: 'stair-floor5',
    label: '5階移動',
    description:
      'エレベーターのない建物などで、階段を利用して移動する際の介助です。階数や介助人数により料金が異なります。',
    amount: 10000,
    order: 6,
  },
]

/** estimate-config.json waitingFees（往復アドオン） */
export const ROUND_TRIP_ADDON_CATALOG: AssistCatalogItem[] = [
  {
    id: 'waiting',
    label: '待機（30分）',
    description: '病院内などでの待機に対応します。表示料金は30分を基準とした概算です。',
    amount: 800,
    order: 1,
  },
  {
    id: 'hospital-escort',
    label: '付き添い（30分）',
    description:
      '受付、施設内移動、会計、薬の受け取りなどをお手伝いします。表示料金は30分を基準とした概算です。',
    amount: 1600,
    order: 2,
  },
]

/** care-taxi-meter 固有のその他サービス（マスタ金額を維持） */
export const EXTRA_SERVICE_CATALOG: AssistCatalogItem[] = [
  {
    id: 'reservedPickup',
    label: '予約迎車',
    description: '予約に基づく迎車料金です。',
    amount: 800,
    order: 1,
  },
  {
    id: 'oneBoxLift',
    label: '1BOXリフト車両',
    description: '1BOXリフト車両の使用料です。',
    amount: 1000,
    order: 2,
  },
]

/** estimate-config.json mappings.mobilityAssistance */
export const MOBILITY_ASSISTANCE_RULES: Record<string, MobilityAssistanceRule> = {
  'cane-walk': {
    mode: 'select',
    assistanceIds: ['watch-assist', 'boarding-assist', 'body-assist'],
    assistanceId: 'watch-assist',
  },
  'own-wheelchair': {
    mode: 'required',
    assistanceIds: ['boarding-assist', 'body-assist'],
  },
  'free-wheelchair': {
    mode: 'required',
    assistanceIds: ['boarding-assist', 'body-assist'],
  },
  'reclining-wheelchair': {
    mode: 'required',
    assistanceIds: ['boarding-assist', 'body-assist'],
  },
  stretcher: {
    mode: 'fixed',
    assistanceIds: [],
    assistanceId: 'body-assist',
  },
}

const STEP_ORDER: AssistChoiceStepId[] = ['mobility', 'assistance', 'stair', 'extras']

const findCatalogItem = (catalog: AssistCatalogItem[], id: string) =>
  catalog.find((item) => item.id === id) || null

export const getMobilityAssistanceRule = (
  mobilityId: string,
): MobilityAssistanceRule | null => MOBILITY_ASSISTANCE_RULES[mobilityId] || null

export const getAssistanceOptions = (mobilityId: string): AssistCatalogItem[] => {
  const rule = getMobilityAssistanceRule(mobilityId)
  if (!rule) {
    return ASSISTANCE_CATALOG.slice()
  }
  if (rule.mode === 'fixed') {
    const fixed = findCatalogItem(ASSISTANCE_CATALOG, rule.assistanceId || '')
    return fixed ? [fixed] : []
  }
  return ASSISTANCE_CATALOG.filter((item) => rule.assistanceIds.includes(item.id))
}

/** estimate-calc.js resolveAssistanceId */
export const resolveAssistanceId = (state: PreFixedAssistSelectionState): string => {
  const rule = getMobilityAssistanceRule(state.mobilityId)
  if (rule?.mode === 'fixed' && rule.assistanceId) {
    return rule.assistanceId
  }
  return state.assistanceId
}

export const syncAssistanceForMobility = (
  state: PreFixedAssistSelectionState,
): PreFixedAssistSelectionState => {
  const rule = getMobilityAssistanceRule(state.mobilityId)
  if (!rule) {
    return state
  }
  if (rule.mode === 'fixed' && rule.assistanceId) {
    return { ...state, assistanceId: rule.assistanceId }
  }
  const options = getAssistanceOptions(state.mobilityId)
  if (state.assistanceId && options.some((item) => item.id === state.assistanceId)) {
    return state
  }
  return { ...state, assistanceId: '' }
}

/** estimate-main.js clearStepsAfter — 後続ステップをクリア */
export const clearStepsAfter = (
  state: PreFixedAssistSelectionState,
  stepId: AssistChoiceStepId,
): PreFixedAssistSelectionState => {
  const index = STEP_ORDER.indexOf(stepId)
  let next = { ...state }
  if (index < STEP_ORDER.indexOf('assistance')) {
    next = syncAssistanceForMobility({ ...next, assistanceId: '' })
    if (getMobilityAssistanceRule(next.mobilityId)?.mode !== 'fixed') {
      next.assistanceId = ''
    }
  }
  if (index < STEP_ORDER.indexOf('stair')) {
    next.stairId = ''
  }
  if (index < STEP_ORDER.indexOf('extras')) {
    next.extraIds = []
    next.roundTripAddonId = ''
  }
  return next
}

/** estimate-main.js openStepForEdit — 変更時は後続クリア＋当該クリア */
export const openStepForEdit = (
  state: PreFixedAssistSelectionState,
  stepId: AssistChoiceStepId,
): PreFixedAssistSelectionState => {
  let next = clearStepsAfter(state, stepId)
  if (stepId === 'mobility') {
    next = { ...next, mobilityId: '', assistanceId: '', stairId: '', extraIds: [], roundTripAddonId: '' }
  } else if (stepId === 'assistance') {
    next = syncAssistanceForMobility({ ...next, assistanceId: '' })
    if (getMobilityAssistanceRule(next.mobilityId)?.mode !== 'fixed') {
      next.assistanceId = ''
    }
  } else if (stepId === 'stair') {
    next = { ...next, stairId: '' }
  } else if (stepId === 'extras') {
    next = { ...next, extraIds: [], roundTripAddonId: '' }
  }
  return { ...next, editingStepId: stepId }
}

export const applyMeterEditChoice = (
  state: PreFixedAssistSelectionState,
  stepId: AssistChoiceStepId,
  choiceId: string,
): PreFixedAssistSelectionState => {
  if (stepId === 'mobility') {
    const next = syncAssistanceForMobility({
      ...state,
      mobilityId: choiceId,
      editingStepId: null,
    })
    return next
  }
  if (stepId === 'assistance') {
    return { ...state, assistanceId: choiceId, editingStepId: null }
  }
  if (stepId === 'stair') {
    return { ...state, stairId: choiceId, editingStepId: null }
  }
  if (ROUND_TRIP_ADDON_CATALOG.some((item) => item.id === choiceId)) {
    return applyRoundTripAddon(state, choiceId)
  }
  return toggleExtraChoice(state, choiceId)
}

/** 保存済み serviceFees / careOptions から AssistItem[] を復元（0円選択も含む） */
export const hydrateAssistItemsFromSavedFees = (
  serviceFees: Array<{ key: string; label: string; amount: number }> = [],
  careOptions: Array<{ masterId?: string; id: string; name: string; amountYen: number }> = [],
): AssistItem[] => {
  const byId = new Map<string, AssistItem>()
  let sortOrder = 1

  const upsert = (id: string, name: string, amount: number) => {
    const normalizedId = id.trim()
    if (!normalizedId) {
      return
    }
    const existing = byId.get(normalizedId)
    if (existing) {
      byId.set(normalizedId, {
        ...existing,
        name: name || existing.name,
        amount: Number.isFinite(amount) ? Math.round(amount) : existing.amount,
        enabled: true,
      })
      return
    }
    byId.set(normalizedId, {
      id: normalizedId,
      name: name || normalizedId,
      amount: Number.isFinite(amount) ? Math.round(amount) : 0,
      enabled: true,
      sortOrder: sortOrder++,
    })
  }

  for (const fee of serviceFees) {
    // 0円の選択済み項目（無料車いす・階段介助なし等）も復元する
    if (!Number.isFinite(fee.amount) || fee.amount < 0) {
      continue
    }
    upsert(fee.key, fee.label || fee.key, fee.amount)
  }

  for (const option of careOptions) {
    const id = (option.masterId || option.id || '').trim()
    if (!id) {
      continue
    }
    upsert(id, option.name, option.amountYen)
  }

  return Array.from(byId.values())
}

/** 基本メニュー用：別名IDを正規化して選択集合を作る */
export const normalizeExtraFeeSelectedIds = (
  rawIds: Iterable<string>,
): Set<string> => {
  const next = new Set<string>()
  for (const raw of rawIds) {
    const id = raw.trim()
    if (!id) {
      continue
    }
    if (id === 'waiting') {
      next.add('waitingPlanned')
      continue
    }
    if (id === 'hospital-escort') {
      next.add('escortPlanned')
      continue
    }
    next.add(id)
  }
  return next
}

export const applyStepChoice = (
  state: PreFixedAssistSelectionState,
  stepId: AssistChoiceStepId,
  choiceId: string,
): PreFixedAssistSelectionState => {
  let next = clearStepsAfter(state, stepId)
  if (stepId === 'mobility') {
    next = syncAssistanceForMobility({ ...next, mobilityId: choiceId })
  } else if (stepId === 'assistance') {
    next = { ...next, assistanceId: choiceId }
  } else if (stepId === 'stair') {
    next = { ...next, stairId: choiceId }
  }
  next.editingStepId = null
  return next
}

export const toggleExtraChoice = (
  state: PreFixedAssistSelectionState,
  extraId: string,
): PreFixedAssistSelectionState => {
  const has = state.extraIds.includes(extraId)
  return {
    ...state,
    extraIds: has ? state.extraIds.filter((id) => id !== extraId) : [...state.extraIds, extraId],
  }
}

export const applyRoundTripAddon = (
  state: PreFixedAssistSelectionState,
  addonId: string,
): PreFixedAssistSelectionState => ({
  ...state,
  roundTripAddonId: addonId,
})

export const isAssistStepComplete = (
  state: PreFixedAssistSelectionState,
  stepId: AssistChoiceStepId,
): boolean => {
  if (stepId === 'mobility') {
    return Boolean(state.mobilityId)
  }
  if (stepId === 'assistance') {
    return Boolean(resolveAssistanceId(state))
  }
  if (stepId === 'stair') {
    return Boolean(state.stairId)
  }
  if (stepId === 'extras') {
    // その他は任意（往復アドオンも任意）
    return true
  }
  return false
}

export const getNaturalActiveAssistStep = (
  state: PreFixedAssistSelectionState,
): AssistChoiceStepId => {
  if (state.editingStepId) {
    return state.editingStepId
  }
  for (const stepId of STEP_ORDER) {
    if (stepId === 'extras') {
      continue
    }
    if (!isAssistStepComplete(state, stepId)) {
      return stepId
    }
  }
  return 'extras'
}

export const areRequiredAssistStepsComplete = (state: PreFixedAssistSelectionState) =>
  Boolean(state.mobilityId) &&
  Boolean(resolveAssistanceId(state)) &&
  Boolean(state.stairId)

export type AssistFeeBreakdown = {
  wheelchairFee: number
  assistanceFee: number
  stairFee: number
  extraFee: number
  roundTripAddonFee: number
  careAssistTotal: number
  specialVehicleTotal: number
  serviceTotal: number
}

export const computeAssistFeeBreakdown = (
  state: PreFixedAssistSelectionState,
): AssistFeeBreakdown => {
  const mobility = findCatalogItem(MOBILITY_CATALOG, state.mobilityId)
  const assistance = findCatalogItem(ASSISTANCE_CATALOG, resolveAssistanceId(state))
  const stair = findCatalogItem(STAIR_CATALOG, state.stairId)
  const extras = EXTRA_SERVICE_CATALOG.filter((item) => state.extraIds.includes(item.id))
  const addon = findCatalogItem(ROUND_TRIP_ADDON_CATALOG, state.roundTripAddonId)

  const wheelchairFee = mobility?.amount ?? 0
  const assistanceFee = assistance?.amount ?? 0
  const stairFee = stair?.amount ?? 0
  const specialVehicleTotal = extras
    .filter((item) => item.id === 'oneBoxLift')
    .reduce((sum, item) => sum + item.amount, 0)
  const extraFee = extras.reduce((sum, item) => sum + item.amount, 0)
  const roundTripAddonFee = addon?.amount ?? 0
  const careAssistTotal = wheelchairFee + assistanceFee + stairFee + (extraFee - specialVehicleTotal) + roundTripAddonFee
  const serviceTotal = wheelchairFee + assistanceFee + stairFee + extraFee + roundTripAddonFee

  return {
    wheelchairFee,
    assistanceFee,
    stairFee,
    extraFee,
    roundTripAddonFee,
    careAssistTotal,
    specialVehicleTotal,
    serviceTotal,
  }
}

/** ルート運賃と介助料金を分離したまま総額を算出する（二重加算しない） */
export const calculatePreFixedFareBreakdown = ({
  routeFareYen,
  assistFeesYen,
}: {
  routeFareYen: number
  assistFeesYen: number
}) => {
  const safeRouteFareYen = Math.max(0, Math.round(Number(routeFareYen) || 0))
  const safeAssistFeesYen = Math.max(0, Math.round(Number(assistFeesYen) || 0))
  return {
    routeFareYen: safeRouteFareYen,
    assistFeesYen: safeAssistFeesYen,
    totalEstimatedFareYen: safeRouteFareYen + safeAssistFeesYen,
  }
}

/** ルート候補の fixedFareYen（routeFareYen）は維持し、介助料金だけ差し替える */
export const applyAssistFeesToRouteCandidates = (
  candidates: PreFixedRouteCandidate[],
  assistFeesYen: number,
): PreFixedRouteCandidate[] =>
  candidates.map((candidate) => {
    const breakdown = calculatePreFixedFareBreakdown({
      routeFareYen: candidate.fixedFareYen,
      assistFeesYen,
    })
    return {
      ...candidate,
      fixedFareYen: breakdown.routeFareYen,
      serviceFeesYen: breakdown.assistFeesYen,
      totalYen: breakdown.totalEstimatedFareYen,
    }
  })

/** 確認画面用の介助・サービス内訳行 */
export const buildAssistFeeLineItems = (
  state: PreFixedAssistSelectionState,
): Array<{ label: string; amount: number }> => {
  const lines: Array<{ label: string; amount: number }> = []
  const mobility = findCatalogItem(MOBILITY_CATALOG, state.mobilityId)
  if (mobility) {
    lines.push({ label: mobility.label, amount: mobility.amount })
  }
  const assistance = findCatalogItem(ASSISTANCE_CATALOG, resolveAssistanceId(state))
  if (assistance) {
    lines.push({ label: assistance.label, amount: assistance.amount })
  }
  const stair = findCatalogItem(STAIR_CATALOG, state.stairId)
  if (stair) {
    lines.push({ label: stair.label, amount: stair.amount })
  }
  for (const extraId of state.extraIds) {
    const extra = findCatalogItem(EXTRA_SERVICE_CATALOG, extraId)
    if (extra) {
      lines.push({ label: extra.label, amount: extra.amount })
    }
  }
  const addon = findCatalogItem(ROUND_TRIP_ADDON_CATALOG, state.roundTripAddonId)
  if (addon) {
    if (addon.id === 'waiting') {
      lines.push({ label: '待機料金（予定30分）', amount: addon.amount })
    } else if (addon.id === 'hospital-escort') {
      lines.push({ label: '付き添い料金（予定30分）', amount: addon.amount })
    } else {
      lines.push({ label: addon.label, amount: addon.amount })
    }
  }
  return lines
}

const LEGACY_ID_TO_MOBILITY: Record<string, string> = {
  standardWheelchair: 'free-wheelchair',
  freeWheelchair: 'free-wheelchair',
  'free-wheelchair': 'free-wheelchair',
  '標準車いす': 'free-wheelchair',
  ownWheelchair: 'own-wheelchair',
  'own-wheelchair': 'own-wheelchair',
  recliningWheelchair: 'reclining-wheelchair',
  recliningAssist: 'reclining-wheelchair',
  'reclining-wheelchair': 'reclining-wheelchair',
  stretcherEquipment: 'stretcher',
  stretcherAssist: 'stretcher',
  stretcher: 'stretcher',
  caneWalk: 'cane-walk',
  'cane-walk': 'cane-walk',
}

const LEGACY_ID_TO_ASSISTANCE: Record<string, string> = {
  boardingAssist: 'boarding-assist',
  'boarding-assist': 'boarding-assist',
  bodyAssist: 'body-assist',
  'body-assist': 'body-assist',
  watchAssist: 'watch-assist',
  'watch-assist': 'watch-assist',
  basicAssist: 'boarding-assist',
  indoorAssist: 'body-assist',
  wheelchairAssist: 'boarding-assist',
}

const LEGACY_ID_TO_STAIR: Record<string, string> = {
  stairsAssist: 'stair-none',
  'stair-none': 'stair-none',
  'stair-watch': 'stair-watch',
  'stair-floor2': 'stair-floor2',
  'stair-floor3': 'stair-floor3',
  'stair-floor4': 'stair-floor4',
  'stair-floor5': 'stair-floor5',
  stairFloor2: 'stair-floor2',
  stairFloor3: 'stair-floor3',
  stairFloor4: 'stair-floor4',
  stairFloor5: 'stair-floor5',
}

const CANONICAL_TO_METER_ID: Record<string, string> = {
  'free-wheelchair': 'standardWheelchair',
  'own-wheelchair': 'ownWheelchair',
  'reclining-wheelchair': 'recliningWheelchair',
  stretcher: 'stretcherEquipment',
  'cane-walk': 'caneWalk',
  'watch-assist': 'watchAssist',
  'boarding-assist': 'boardingAssist',
  'body-assist': 'bodyAssist',
  'stair-none': 'stairsAssist',
  'stair-watch': 'stairWatch',
  'stair-floor2': 'stairFloor2',
  'stair-floor3': 'stairFloor3',
  'stair-floor4': 'stairFloor4',
  'stair-floor5': 'stairFloor5',
  waiting: 'waitingPlanned',
  'hospital-escort': 'escortPlanned',
  reservedPickup: 'reservedPickup',
  oneBoxLift: 'oneBoxLift',
}

/** 旧チェックボックス AssistItem[] → 新STEP状態 */
export const selectionStateFromAssistItems = (
  items: AssistItem[],
): PreFixedAssistSelectionState => {
  const enabled = items.filter((item) => item.enabled)
  const state = createEmptyAssistSelectionState()

  const resolveByLabel = (
    catalog: AssistCatalogItem[],
    name: string,
  ): string | undefined => catalog.find((entry) => entry.label === name.trim())?.id

  for (const item of enabled) {
    const mobility =
      LEGACY_ID_TO_MOBILITY[item.id] ||
      LEGACY_ID_TO_MOBILITY[item.name] ||
      resolveByLabel(MOBILITY_CATALOG, item.name) ||
      (item.name.includes('無料車いす') || item.name.includes('標準車いす')
        ? 'free-wheelchair'
        : undefined)
    if (mobility && !state.mobilityId) {
      state.mobilityId = mobility
      continue
    }
    const assistance =
      LEGACY_ID_TO_ASSISTANCE[item.id] || resolveByLabel(ASSISTANCE_CATALOG, item.name)
    if (assistance && !state.assistanceId) {
      state.assistanceId = assistance
      continue
    }
    const stair =
      LEGACY_ID_TO_STAIR[item.id] || resolveByLabel(STAIR_CATALOG, item.name)
    if (stair && !state.stairId) {
      // 旧 stairsAssist(0円) は「なし」扱い。金額付き旧データは階数IDへ。
      if (item.id === 'stairsAssist' && item.amount > 0) {
        // 金額から階を推定（旧データ互換の最終手段）
        const byAmount = STAIR_CATALOG.find((entry) => entry.amount === item.amount)
        state.stairId = byAmount?.id || 'stair-none'
      } else {
        state.stairId = stair
      }
      continue
    }
    if (item.id === 'reservedPickup' || item.id === 'oneBoxLift' || item.name === '予約迎車' || item.name === '1BOXリフト車両') {
      const extraId =
        item.id === 'reservedPickup' || item.name === '予約迎車'
          ? 'reservedPickup'
          : 'oneBoxLift'
      if (!state.extraIds.includes(extraId)) {
        state.extraIds.push(extraId)
      }
      continue
    }
    if (item.id === 'waitingPlanned' || item.id === 'waiting' || item.name.startsWith('待機')) {
      state.roundTripAddonId = 'waiting'
      continue
    }
    if (
      item.id === 'escortPlanned' ||
      item.id === 'hospital-escort' ||
      item.name.startsWith('付き添い')
    ) {
      state.roundTripAddonId = 'hospital-escort'
    }
  }

  return syncAssistanceForMobility({
    ...state,
    editingStepId: areRequiredAssistStepsComplete(state) ? null : getNaturalActiveAssistStep(state),
  })
}

/** STEP状態 → セッション保存用 AssistItem[]（二重なし・正規ID） */
export const assistItemsFromSelectionState = (
  state: PreFixedAssistSelectionState,
  baseItems: AssistItem[] = [],
): AssistItem[] => {
  const enabledIds = new Set<string>()
  const amountById = new Map<string, number>()
  const nameById = new Map<string, string>()

  const push = (canonicalId: string, label: string, amount: number) => {
    const meterId = CANONICAL_TO_METER_ID[canonicalId] || canonicalId
    enabledIds.add(meterId)
    amountById.set(meterId, amount)
    nameById.set(meterId, label)
  }

  const mobility = findCatalogItem(MOBILITY_CATALOG, state.mobilityId)
  if (mobility) {
    push(mobility.id, mobility.label, mobility.amount)
  }
  const assistanceId = resolveAssistanceId(state)
  const assistance = findCatalogItem(ASSISTANCE_CATALOG, assistanceId)
  if (assistance) {
    push(assistance.id, assistance.label, assistance.amount)
  }
  const stair = findCatalogItem(STAIR_CATALOG, state.stairId)
  if (stair) {
    push(stair.id, stair.label, stair.amount)
  }
  for (const extraId of state.extraIds) {
    const extra = findCatalogItem(EXTRA_SERVICE_CATALOG, extraId)
    if (extra) {
      push(extra.id, extra.label, extra.amount)
    }
  }
  const addon = findCatalogItem(ROUND_TRIP_ADDON_CATALOG, state.roundTripAddonId)
  if (addon) {
    push(addon.id, addon.label, addon.amount)
  }

  const byId = new Map(baseItems.map((item) => [item.id, item]))
  const result: AssistItem[] = []

  // ベース一覧を更新（未選択は enabled:false）
  for (const item of baseItems) {
    const enabled = enabledIds.has(item.id)
    result.push({
      ...item,
      enabled,
      amount: enabled ? amountById.get(item.id) ?? item.amount : item.amount,
      name: enabled ? nameById.get(item.id) || item.name : item.name,
    })
    enabledIds.delete(item.id)
  }

  // ベースに無い正規IDを追加
  let sortOrder = 200
  for (const id of enabledIds) {
    if (byId.has(id)) {
      continue
    }
    result.push({
      id,
      name: nameById.get(id) || id,
      amount: amountById.get(id) || 0,
      enabled: true,
      sortOrder: sortOrder++,
    })
  }

  return result
}

export const getStepSummaryLabel = (
  state: PreFixedAssistSelectionState,
  stepId: AssistChoiceStepId,
): string => {
  if (stepId === 'mobility') {
    return findCatalogItem(MOBILITY_CATALOG, state.mobilityId)?.label || '未選択'
  }
  if (stepId === 'assistance') {
    return findCatalogItem(ASSISTANCE_CATALOG, resolveAssistanceId(state))?.label || '未選択'
  }
  if (stepId === 'stair') {
    return findCatalogItem(STAIR_CATALOG, state.stairId)?.label || '未選択'
  }
  const extras = EXTRA_SERVICE_CATALOG.filter((item) => state.extraIds.includes(item.id)).map(
    (item) => item.label,
  )
  const addon = findCatalogItem(ROUND_TRIP_ADDON_CATALOG, state.roundTripAddonId)
  if (addon) {
    extras.push(addon.label)
  }
  return extras.length ? extras.join('、') : 'なし'
}

export const ASSIST_STEP_TITLES: Record<AssistChoiceStepId, string> = {
  mobility: '移動方法',
  assistance: '介助内容',
  stair: '階段介助',
  extras: 'その他サービス',
}
