import {
  ADDITIONAL_DISTANCE_KM,
  ADDITIONAL_FARE_YEN,
  INITIAL_DISTANCE_KM,
  INITIAL_FARE_YEN,
  TIME_DISTANCE_FARE_YEN,
  TIME_DISTANCE_SECONDS,
} from '../constants/fareConstants'
import type { MeterMode } from '../types/case'
import { resolveMeterSettingsMode } from '../utils/meterConstants'
import type { TimeMeterSettings } from './meterSettings'
import { calculateTimeMeterFare } from './timeMeterFare'
import {
  resolveMidnightSurchargeYen,
  type MidnightEarlyMorningSettings,
} from '../utils/nightSurcharge'

export type BasicFareSettings = {
  initialDistanceKm: number;
  initialFareYen: number;
  additionalDistanceKm: number;
  additionalFareYen: number;
};

export type TimeFareSettings = {
  unitSeconds: number;
  unitFareYen: number;
};

export type MeterTimeFareSettings = TimeFareSettings & {
  lowSpeedThresholdKmh: number;
};

export type AssistItem = {
  id: string;
  name: string;
  amount: number;
  enabled: boolean;
  sortOrder: number;
};

export type CareOptionMasterItem = AssistItem;
export type DispatchMenuItem = AssistItem;
export type SpecialVehicleMenuItem = AssistItem;

export type ExpenseSettings = {
  defaultItems: Array<{
    id: string;
    name: string;
    defaultAmountYen: number;
  }>;
  defaultNames: string[];
};

export type FareLineItem = {
  label: string;
  amountYen: number;
};

export type TimeMeterFareBreakdown = {
  actualTimeFare: number;
  legalTimeFare: number;
  timeDiscountAmount: number;
  timeDiscountEnabled: boolean;
  initialMinutes: number;
  additionalSeconds: number;
};

export type FareBreakdown = {
  dispatchFareYen: number;
  specialVehicleFareYen: number;
  basicFareYen: number;
  waitingFareYen: number;
  meterTimeFareYen: number;
  escortFareYen: number;
  careOptionFareYen: number;
  customFeeFareYen: number;
  expenseFareYen: number;
  normalFareYen: number;
  nightSurchargeYen: number;
  grossFareYen: number;
  discountableFareYen: number;
  isDisabilityDiscount: boolean;
  disabilityDiscountRate: number;
  disabilityDiscountAmount: number;
  discountName: string;
  discountMethod: DiscountSettings["method"];
  discountValue: number;
  taxiTicketAmountYen: number;
  totalFareYen: number;
  lineItems: FareLineItem[];
  meterMode: MeterMode;
  timeMeter: TimeMeterFareBreakdown | null;
  /** 事前確定M: 当初の事前確定運賃本体（追加区間運賃を含まない） */
  originalConfirmedFareYen?: number;
  /** 事前確定M: ルート変更による追加区間運賃 */
  additionalRouteFareYen?: number;
  /** 事前確定M: ルート変更時に手動加算した追加介助料 */
  additionalCareFareYen?: number;
};

export const basicFareSettings: BasicFareSettings = {
  initialDistanceKm: INITIAL_DISTANCE_KM,
  initialFareYen: INITIAL_FARE_YEN,
  additionalDistanceKm: ADDITIONAL_DISTANCE_KM,
  additionalFareYen: ADDITIONAL_FARE_YEN,
};

export const waitingFareSettings: TimeFareSettings = {
  unitSeconds: 1800,
  unitFareYen: 800,
};

export const escortFareSettings: TimeFareSettings = {
  unitSeconds: 1800,
  unitFareYen: 1600,
};

export const meterTimeFareSettings: MeterTimeFareSettings = {
  lowSpeedThresholdKmh: 10,
  unitSeconds: TIME_DISTANCE_SECONDS,
  unitFareYen: TIME_DISTANCE_FARE_YEN,
};

export const dispatchMenuMaster: DispatchMenuItem[] = [
  { id: "reservedPickup", name: "予約迎車", amount: 800, enabled: true, sortOrder: 1 },
];

export const specialVehicleMenuMaster: SpecialVehicleMenuItem[] = [
  { id: "oneBoxLift", name: "1BOXリフト車両", amount: 1000, enabled: true, sortOrder: 1 },
];

export const careOptionMaster: CareOptionMasterItem[] = [
  { id: "boardingAssist", name: "乗降介助", amount: 1100, enabled: true, sortOrder: 1 },
  { id: "bodyAssist", name: "身体介助", amount: 1600, enabled: true, sortOrder: 2 },
  { id: "stairsAssist", name: "階段介助", amount: 0, enabled: true, sortOrder: 3 },
  { id: "standardWheelchair", name: "標準車いす", amount: 0, enabled: true, sortOrder: 4 },
  { id: "recliningWheelchair", name: "リクライニング車いす", amount: 2500, enabled: true, sortOrder: 5 },
  { id: "stretcherEquipment", name: "ストレッチャー", amount: 4000, enabled: true, sortOrder: 6 },
];

/** @deprecated 旧名称・旧料金 — 読み込み互換のみ */
export const deprecatedCareOptionMaster: CareOptionMasterItem[] = [
  { id: "basicAssist", name: "基本介助", amount: 500, enabled: false, sortOrder: 90 },
  { id: "indoorAssist", name: "室内介助", amount: 500, enabled: false, sortOrder: 91 },
  { id: "wheelchairAssist", name: "車椅子介助", amount: 500, enabled: false, sortOrder: 92 },
  { id: "stretcherAssist", name: "ストレッチャー", amount: 1500, enabled: false, sortOrder: 93 },
  { id: "recliningAssist", name: "リクライニング", amount: 1000, enabled: false, sortOrder: 94 },
];

export const expenseSettings: ExpenseSettings = {
  defaultItems: [
    { id: "parking", name: "駐車場", defaultAmountYen: 0 },
    { id: "expressway", name: "高速", defaultAmountYen: 0 },
    { id: "toll-road", name: "有料道路", defaultAmountYen: 0 },
    { id: "ferry", name: "フェリー", defaultAmountYen: 0 },
    { id: "other-expense", name: "その他", defaultAmountYen: 0 },
  ],
  defaultNames: ["駐車場", "高速", "有料道路", "フェリー", "その他"],
};

export type DiscountSettings = {
  name: string;
  method: "percentage" | "fixed";
  value: number;
};

export const DEFAULT_DISCOUNT_SETTINGS: DiscountSettings = {
  name: "障害者割引",
  method: "percentage",
  value: 10,
};

export const roundDownToTenYen = (amountYen: number) =>
  Math.floor(Math.max(amountYen, 0) / 10) * 10;

export function calculateBasicFareYen(
  distanceKm: number,
  settings: BasicFareSettings = basicFareSettings,
) {
  if (distanceKm <= settings.initialDistanceKm) {
    return settings.initialFareYen;
  }

  const additionalDistanceKm = distanceKm - settings.initialDistanceKm;
  const additionalFareCount = Math.ceil(
    additionalDistanceKm / settings.additionalDistanceKm,
  );

  return (
    settings.initialFareYen + additionalFareCount * settings.additionalFareYen
  );
}

export function calculateTimeFareYen(
  elapsedSeconds: number,
  settings: TimeFareSettings,
) {
  if (elapsedSeconds <= 0) {
    return 0;
  }

  return (
    Math.ceil(elapsedSeconds / settings.unitSeconds) * settings.unitFareYen
  );
}

/**
 * 事前確定Mの待機・付き添い料金。
 * 0秒のみ0円。1秒から unitSeconds ごとに切り上げ加算
 * （例: 1〜1800秒=1単位、1801〜3600秒=2単位）。
 *
 * isRoundTrip は互換のため残すが、片道・往復とも同じ計算。
 */
export const PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS = 30 * 60

/** @deprecated 旧「30分未満無料」定数名。単位秒として PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS を使う */
export const PRE_FIXED_WAITING_ESCORT_FREE_SECONDS = PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS

/** @deprecated PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS と同一 */
export const PRE_FIXED_ROUND_TRIP_FREE_SECONDS = PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS

export function calculateTimedFeeYen(
  elapsedSeconds: number,
  unitSeconds: number,
  unitFareYen: number,
) {
  const safeElapsedSeconds = Math.max(0, Math.floor(elapsedSeconds))
  if (safeElapsedSeconds <= 0) {
    return 0
  }

  const safeUnitSeconds = Math.max(1, Math.floor(unitSeconds) || PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS)
  const safeUnitFareYen = Math.max(0, Math.round(unitFareYen) || 0)
  return Math.ceil(safeElapsedSeconds / safeUnitSeconds) * safeUnitFareYen
}

export function calculatePreFixedWaitingEscortFareYen(
  elapsedSeconds: number,
  settings: TimeFareSettings,
  _isRoundTrip = false,
) {
  const unitSeconds = Math.max(1, Math.floor(settings.unitSeconds) || PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS)
  const unitFareYen = Math.max(0, Math.round(settings.unitFareYen) || 0)
  return calculateTimedFeeYen(elapsedSeconds, unitSeconds, unitFareYen)
}

/**
 * 見積で先に含めた待機／付き添い単位と実時間単位の大きい方だけを計上し、
 * 明細へ既に載せた予定分は差し引いて追加分のみ返す。
 *
 * finalBlocks = max(prepaidUnits, actualBlocks)
 * billableYen = max(0, finalBlocks - prepaidUnits) * unitFare
 */
export function calculatePrepaidWaitingEscortBillableYen(
  elapsedSeconds: number,
  settings: TimeFareSettings,
  prepaidUnits: number,
) {
  const unitSeconds = Math.max(1, Math.floor(settings.unitSeconds) || PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS)
  const unitFareYen = Math.max(0, Math.round(settings.unitFareYen) || 0)
  const safePrepaidUnits = Math.max(0, Math.floor(prepaidUnits))
  const actualBlocks =
    elapsedSeconds <= 0 ? 0 : Math.ceil(Math.max(0, Math.floor(elapsedSeconds)) / unitSeconds)
  const finalBlocks = Math.max(safePrepaidUnits, actualBlocks)
  return Math.max(finalBlocks - safePrepaidUnits, 0) * unitFareYen
}

/** 事前選択分を含む待機／付き添いの最終合計金額 */
export function calculateFinalWaitingEscortFareYen(
  elapsedSeconds: number,
  settings: TimeFareSettings,
  prepaidUnits: number,
) {
  const unitSeconds = Math.max(1, Math.floor(settings.unitSeconds) || PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS)
  const unitFareYen = Math.max(0, Math.round(settings.unitFareYen) || 0)
  const safePrepaidUnits = Math.max(0, Math.floor(prepaidUnits))
  const actualBlocks =
    elapsedSeconds <= 0 ? 0 : Math.ceil(Math.max(0, Math.floor(elapsedSeconds)) / unitSeconds)
  const finalBlocks = Math.max(safePrepaidUnits, actualBlocks)
  return finalBlocks * unitFareYen
}

export function formatTimedFeeDurationLabelJa(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  if (hours > 0 && minutes > 0) {
    return `${hours}時間${minutes}分`
  }
  if (hours > 0) {
    return `${hours}時間`
  }
  if (minutes > 0) {
    return `${minutes}分`
  }
  if (safeSeconds > 0) {
    return `${safeSeconds}秒`
  }
  return '0分'
}

export function buildWaitingEscortFareDisplayLabel({
  kind,
  elapsedSeconds,
  prepaidUnits,
  unitSeconds = PRE_FIXED_WAITING_ESCORT_UNIT_SECONDS,
}: {
  kind: 'waiting' | 'escort'
  elapsedSeconds: number
  prepaidUnits: number
  unitSeconds?: number
}): string {
  const base = kind === 'waiting' ? '待機料金' : '付き添い料金'
  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds))
  const safePrepaid = Math.max(0, Math.floor(prepaidUnits))
  if (safeElapsed > 0) {
    return `${base}（${formatTimedFeeDurationLabelJa(safeElapsed)}）`
  }
  if (safePrepaid > 0) {
    const plannedMinutes = Math.max(
      1,
      Math.round((safePrepaid * Math.max(1, unitSeconds)) / 60),
    )
    return `${base}（予定${plannedMinutes}分）`
  }
  return base
}

export function isWaitingServiceFeeKey(key: string): boolean {
  return (
    key === 'waiting' ||
    key === 'waitingFee' ||
    key === 'waiting30min' ||
    key === 'waitingPlanned'
  )
}

export function isEscortServiceFeeKey(key: string): boolean {
  return (
    key === 'hospital-escort' ||
    key === 'escortFee' ||
    key === 'escort30min' ||
    key === 'escortPlanned'
  )
}

/** 見積サービス料金から待機／付き添いの予定単位数を取り出す */
export function resolveWaitingEscortPrepaidUnitsFromServiceFees(
  serviceFees: Array<{ key: string; amount: number }> | undefined,
): { waitingPrepaidUnits: number; escortPrepaidUnits: number } {
  let waitingPrepaidUnits = 0
  let escortPrepaidUnits = 0
  for (const fee of serviceFees ?? []) {
    if (!Number.isFinite(fee.amount) || fee.amount <= 0) {
      continue
    }
    if (isWaitingServiceFeeKey(fee.key)) {
      waitingPrepaidUnits += 1
    }
    if (isEscortServiceFeeKey(fee.key)) {
      escortPrepaidUnits += 1
    }
  }
  return { waitingPrepaidUnits, escortPrepaidUnits }
}

export function calculateMeterTimeFareYen(
  elapsedSeconds: number,
  settings: TimeFareSettings,
) {
  if (elapsedSeconds < settings.unitSeconds) {
    return 0;
  }

  return Math.floor(elapsedSeconds / settings.unitSeconds) * settings.unitFareYen;
}

export function calculateCareOptionTotalYen(
  careOptions: Array<{ amountYen: number }>,
) {
  return careOptions.reduce((total, option) => total + option.amountYen, 0);
}

export function calculateExpenseTotalYen(
  expenses: Array<{ amountYen: number }>,
) {
  return expenses.reduce((total, expense) => total + expense.amountYen, 0);
}

export function calculateCustomFeeTotalYen(
  customFees: Array<{ amount: number }>,
) {
  return customFees.reduce((total, fee) => total + fee.amount, 0);
}

export function calculateTimeFareIncreaseProgress(
  elapsedSeconds: number,
  settings: TimeFareSettings,
) {
  if (elapsedSeconds <= 0) {
    return {
      progressRate: 0,
      remainingSeconds: settings.unitSeconds,
      nextIncreaseYen: settings.unitFareYen,
    };
  }

  const secondsIntoCurrentUnit = elapsedSeconds % settings.unitSeconds;
  const remainingSeconds =
    secondsIntoCurrentUnit === 0
      ? settings.unitSeconds
      : settings.unitSeconds - secondsIntoCurrentUnit;

  return {
    progressRate: Math.min(secondsIntoCurrentUnit / settings.unitSeconds, 1),
    remainingSeconds,
    nextIncreaseYen: settings.unitFareYen,
  };
}

export function formatFareYen(fareYen: number) {
  return fareYen.toLocaleString("ja-JP");
}

export function calculateFareBreakdown({
  distanceKm,
  waitingSeconds,
  escortSeconds,
  meterTimeSeconds = 0,
  dispatchCharges = [],
  specialVehicleCharges = [],
  careOptions,
  customFees = [],
  expenses,
  isDisabilityDiscount = false,
  taxiTickets = [],
  settings = {},
  meterMode = 'gps',
  drivingSeconds = 0,
  timeMeterSettings,
  midnightSettings,
  nightChargeableDistanceKm = 0,
  nightDrivingSeconds = 0,
}: {
  distanceKm: number;
  waitingSeconds: number;
  escortSeconds: number;
  meterTimeSeconds?: number;
  dispatchCharges?: Array<{ amountYen: number }>;
  specialVehicleCharges?: Array<{ amountYen: number }>;
  careOptions: Array<{ amountYen: number }>;
  customFees?: Array<{ amount: number }>;
  expenses: Array<{ amountYen: number }>;
  isDisabilityDiscount?: boolean;
  taxiTickets?: Array<{ amount: number }>;
  settings?: {
    basicFare?: BasicFareSettings;
    escortFare?: TimeFareSettings;
    meterTimeFare?: TimeFareSettings;
    waitingFare?: TimeFareSettings;
    discount?: DiscountSettings;
  };
  meterMode?: MeterMode;
  drivingSeconds?: number;
  timeMeterSettings?: TimeMeterSettings;
  midnightSettings?: MidnightEarlyMorningSettings | null;
  nightChargeableDistanceKm?: number;
  nightDrivingSeconds?: number;
}): FareBreakdown {
  const dispatchFareYen = calculateCareOptionTotalYen(dispatchCharges);
  const specialVehicleFareYen = calculateCareOptionTotalYen(specialVehicleCharges);
  const waitingFareYen = calculateTimeFareYen(
    waitingSeconds,
    settings.waitingFare ?? waitingFareSettings,
  );
  const meterTimeFareYen = calculateMeterTimeFareYen(
    meterTimeSeconds,
    settings.meterTimeFare ?? meterTimeFareSettings,
  );
  const escortFareYen = calculateTimeFareYen(
    escortSeconds,
    settings.escortFare ?? escortFareSettings,
  );
  const careOptionFareYen = calculateCareOptionTotalYen(careOptions);
  const customFeeFareYen = calculateCustomFeeTotalYen(customFees);
  const expenseFareYen = calculateExpenseTotalYen(expenses);
  const discountSettings = settings.discount ?? DEFAULT_DISCOUNT_SETTINGS;
  const discountName = discountSettings.name.trim() || DEFAULT_DISCOUNT_SETTINGS.name;
  const discountValue = Math.max(Number(discountSettings.value) || 0, 0);
  const discountRate = discountSettings.method === "percentage" ? discountValue / 100 : 0;

  if (meterMode === 'time' && timeMeterSettings) {
    const timeMeterResult = calculateTimeMeterFare({
      elapsedSeconds: drivingSeconds,
      discountSettings: timeMeterSettings.discount,
      legalSettings: timeMeterSettings.legal,
    });
    const basicFareYen = timeMeterResult.actualTimeFare;
    const normalFareYen = basicFareYen;
    const nightSurchargeYen = resolveMidnightSurchargeYen({
      basicFareSettings: settings.basicFare ?? basicFareSettings,
      distanceKm,
      drivingSeconds,
      midnightSettings,
      meterMode: 'time',
      nightChargeableDistanceKm,
      nightDrivingSeconds,
      timeMeterSettings,
    });
    const discountableFareYen = basicFareYen;
    const disabilityDiscountAmount = isDisabilityDiscount
      ? Math.min(
          discountSettings.method === "percentage"
            ? roundDownToTenYen(discountableFareYen * discountRate)
            : Math.round(discountValue),
          discountableFareYen,
        )
      : 0;
    const discountedMeterFareYen = Math.max(
      discountableFareYen - disabilityDiscountAmount,
      0,
    );
    const taxiTicketRequestedYen = taxiTickets.reduce(
      (total, ticket) => total + Math.max(Math.round(ticket.amount) || 0, 0),
      0,
    );
    const taxiTicketAmountYen = Math.min(taxiTicketRequestedYen, discountedMeterFareYen);
    const otherChargesYen =
      dispatchFareYen +
      specialVehicleFareYen +
      waitingFareYen +
      escortFareYen +
      careOptionFareYen +
      customFeeFareYen +
      expenseFareYen;
    const grossFareYen = discountableFareYen + nightSurchargeYen + otherChargesYen;
    const totalFareYen = Math.max(
      discountedMeterFareYen + nightSurchargeYen - taxiTicketAmountYen + otherChargesYen,
      0,
    );

    return {
      dispatchFareYen,
      specialVehicleFareYen,
      basicFareYen,
      waitingFareYen,
      meterTimeFareYen: 0,
      escortFareYen,
      careOptionFareYen,
      customFeeFareYen,
      expenseFareYen,
      normalFareYen,
      nightSurchargeYen,
      grossFareYen,
      discountableFareYen,
      isDisabilityDiscount,
      disabilityDiscountRate: discountRate,
      disabilityDiscountAmount,
      discountName,
      discountMethod: discountSettings.method,
      discountValue,
      taxiTicketAmountYen,
      totalFareYen,
      lineItems: [
        { label: '時間制運賃', amountYen: basicFareYen },
        ...(nightSurchargeYen > 0
          ? [{ label: '深夜早朝割増', amountYen: nightSurchargeYen }]
          : []),
        { label: '介助料金', amountYen: careOptionFareYen },
        ...(customFeeFareYen > 0
          ? [{ label: 'その他', amountYen: customFeeFareYen }]
          : []),
        { label: '待機料金', amountYen: waitingFareYen },
        { label: '付き添い料金', amountYen: escortFareYen },
        { label: '予約・迎車料金', amountYen: dispatchFareYen },
        { label: '特殊車両料金', amountYen: specialVehicleFareYen },
        { label: '実費', amountYen: expenseFareYen },
        { label: discountName, amountYen: -disabilityDiscountAmount },
        { label: 'タクシー券', amountYen: -taxiTicketAmountYen },
      ],
      meterMode: 'time',
      timeMeter: {
        actualTimeFare: timeMeterResult.actualTimeFare,
        legalTimeFare: timeMeterResult.legalTimeFare,
        timeDiscountAmount: timeMeterResult.timeDiscountAmount,
        timeDiscountEnabled: timeMeterResult.timeDiscountEnabled,
        initialMinutes: timeMeterResult.initialMinutes,
        additionalSeconds: timeMeterResult.additionalSeconds,
      },
    };
  }

  const basicFareYen = calculateBasicFareYen(
    distanceKm,
    settings.basicFare ?? basicFareSettings,
  );
  const normalFareYen = basicFareYen;
  const nightSurchargeYen = resolveMidnightSurchargeYen({
    basicFareSettings: settings.basicFare ?? basicFareSettings,
    distanceKm,
    drivingSeconds,
    midnightSettings,
    meterMode: resolveMeterSettingsMode(meterMode),
    nightChargeableDistanceKm,
    nightDrivingSeconds,
    timeMeterSettings,
  });
  const discountableFareYen = basicFareYen + meterTimeFareYen;
  const disabilityDiscountAmount = isDisabilityDiscount
    ? Math.min(
        discountSettings.method === "percentage"
          ? roundDownToTenYen(discountableFareYen * discountRate)
          : Math.round(discountValue),
        discountableFareYen,
      )
    : 0;
  const discountedMeterFareYen = Math.max(
    discountableFareYen - disabilityDiscountAmount,
    0,
  );
  const taxiTicketRequestedYen = taxiTickets.reduce(
    (total, ticket) => total + Math.max(Math.round(ticket.amount) || 0, 0),
    0,
  );
  const taxiTicketAmountYen = Math.min(taxiTicketRequestedYen, discountedMeterFareYen);
  const otherChargesYen =
    dispatchFareYen +
    specialVehicleFareYen +
    waitingFareYen +
    escortFareYen +
    careOptionFareYen +
    customFeeFareYen +
    expenseFareYen;
  const grossFareYen = discountableFareYen + nightSurchargeYen + otherChargesYen;
  const totalFareYen = Math.max(
    discountedMeterFareYen + nightSurchargeYen - taxiTicketAmountYen + otherChargesYen,
    0,
  );

  return {
    dispatchFareYen,
    specialVehicleFareYen,
    basicFareYen,
    waitingFareYen,
    meterTimeFareYen,
    escortFareYen,
    careOptionFareYen,
    customFeeFareYen,
    expenseFareYen,
    normalFareYen,
    nightSurchargeYen,
    grossFareYen,
    discountableFareYen,
    isDisabilityDiscount,
    disabilityDiscountRate: discountRate,
    disabilityDiscountAmount,
    discountName,
    discountMethod: discountSettings.method,
    discountValue,
    taxiTicketAmountYen,
    totalFareYen,
    lineItems: [
      { label: "基本運賃", amountYen: basicFareYen + meterTimeFareYen },
      ...(nightSurchargeYen > 0
        ? [{ label: "深夜早朝割増", amountYen: nightSurchargeYen }]
        : []),
      { label: discountName, amountYen: -disabilityDiscountAmount },
      { label: "タクシー券", amountYen: -taxiTicketAmountYen },
      { label: "予約・迎車料金", amountYen: dispatchFareYen },
      { label: "特殊車両料金", amountYen: specialVehicleFareYen },
      { label: "介助料金", amountYen: careOptionFareYen },
      ...(customFeeFareYen > 0
        ? [{ label: "その他", amountYen: customFeeFareYen }]
        : []),
      { label: "待機料金", amountYen: waitingFareYen },
      { label: "付き添い料金", amountYen: escortFareYen },
      { label: "実費", amountYen: expenseFareYen },
    ],
    meterMode,
    timeMeter: null,
  };
}

export function buildFixedFareBreakdown({
  confirmedFareYen,
  additionalRouteFareYen = 0,
  additionalCareFareYen = 0,
  careOptions,
  customFees = [],
  expenses,
  waitingSeconds = 0,
  escortSeconds = 0,
  isRoundTrip: _isRoundTrip = true,
  waitingPrepaidUnits = 0,
  escortPrepaidUnits = 0,
  isDisabilityDiscount = false,
  taxiTickets = [],
  settings = {},
}: {
  confirmedFareYen: number;
  additionalRouteFareYen?: number;
  additionalCareFareYen?: number;
  /** @deprecated 事前確定Mでは確定運賃本体に含め、別加算しない */
  dispatchCharges?: Array<{ amountYen: number }>;
  /** @deprecated 事前確定Mでは確定運賃本体に含め、別加算しない */
  specialVehicleCharges?: Array<{ amountYen: number }>;
  careOptions: Array<{ amountYen: number }>;
  customFees?: Array<{ amount: number }>;
  expenses: Array<{ amountYen: number }>;
  waitingSeconds?: number;
  escortSeconds?: number;
  /** 互換のため残置（片道・往復とも同じ課金式） */
  isRoundTrip?: boolean;
  /** 見積に含めた待機の30分単位数（二重加算防止） */
  waitingPrepaidUnits?: number;
  /** 見積に含めた付添の30分単位数（二重加算防止） */
  escortPrepaidUnits?: number;
  isDisabilityDiscount?: boolean;
  taxiTickets?: Array<{ amount: number }>;
  settings?: {
    waitingFare?: TimeFareSettings;
    escortFare?: TimeFareSettings;
    discount?: DiscountSettings;
  };
}): FareBreakdown {
  const originalConfirmedFareYen = Math.max(Math.round(confirmedFareYen), 0);
  const routeFareYen = Math.max(Math.round(additionalRouteFareYen), 0);
  const manualAdditionalCareFareYen = Math.max(Math.round(additionalCareFareYen), 0);
  const waitingFareYen = calculateFinalWaitingEscortFareYen(
    waitingSeconds,
    settings.waitingFare ?? waitingFareSettings,
    waitingPrepaidUnits,
  )
  const escortFareYen = calculateFinalWaitingEscortFareYen(
    escortSeconds,
    settings.escortFare ?? escortFareSettings,
    escortPrepaidUnits,
  )
  // 介助・サービスは careOptions（待機／付き添い予定分は含めない。waitingFareYen / escortFareYen へ統合）
  const customFeeFareYen = calculateCustomFeeTotalYen(customFees);
  const careOptionFareYen =
    calculateCareOptionTotalYen(careOptions) +
    customFeeFareYen +
    manualAdditionalCareFareYen;
  const expenseFareYen = calculateExpenseTotalYen(expenses);
  const discountSettings = settings.discount ?? DEFAULT_DISCOUNT_SETTINGS;
  const discountName = discountSettings.name.trim() || DEFAULT_DISCOUNT_SETTINGS.name;
  const discountValue = Math.max(Number(discountSettings.value) || 0, 0);
  const discountRate = discountSettings.method === "percentage" ? discountValue / 100 : 0;
  // 当初の事前確定運賃のみ割引対象。追加区間運賃は別明細として加算する。
  const discountableFareYen = originalConfirmedFareYen;
  const disabilityDiscountAmount = isDisabilityDiscount
    ? Math.min(
        discountSettings.method === "percentage"
          ? roundDownToTenYen(discountableFareYen * discountRate)
          : Math.round(discountValue),
        discountableFareYen,
      )
    : 0;
  const discountedBaseFareYen = Math.max(discountableFareYen - disabilityDiscountAmount, 0);
  const taxiTicketRequestedYen = taxiTickets.reduce(
    (total, ticket) => total + Math.max(Math.round(ticket.amount) || 0, 0),
    0,
  );
  const taxiTicketAmountYen = Math.min(taxiTicketRequestedYen, discountedBaseFareYen);
  // 事前確定Mのメーター内訳は専用明細のみ。予約迎車・特殊車両は確定運賃本体に含めず加算しない。
  const otherChargesYen =
    routeFareYen + waitingFareYen + escortFareYen + careOptionFareYen + expenseFareYen;
  const grossFareYen = discountableFareYen + otherChargesYen;
  const totalFareYen = Math.max(
    discountedBaseFareYen - taxiTicketAmountYen + otherChargesYen,
    0,
  );
  const baseFareYen = originalConfirmedFareYen + routeFareYen;
  const hasExtras =
    routeFareYen > 0 || careOptionFareYen > 0 || waitingFareYen + escortFareYen > 0 || expenseFareYen > 0;

  return {
    dispatchFareYen: 0,
    specialVehicleFareYen: 0,
    basicFareYen: baseFareYen,
    waitingFareYen,
    meterTimeFareYen: 0,
    escortFareYen,
    careOptionFareYen,
    customFeeFareYen,
    expenseFareYen,
    normalFareYen: baseFareYen,
    nightSurchargeYen: 0,
    grossFareYen,
    discountableFareYen,
    isDisabilityDiscount,
    disabilityDiscountRate: discountRate,
    disabilityDiscountAmount,
    discountName,
    discountMethod: discountSettings.method,
    discountValue,
    taxiTicketAmountYen,
    totalFareYen,
    // 事前確定M専用内訳。割引・タクシー券も明細に含め、合計と請求額が一致するようにする。
    lineItems: [
      {
        label: hasExtras ? "元の事前確定運賃" : "事前確定運賃",
        amountYen: originalConfirmedFareYen,
      },
      { label: "追加区間運賃", amountYen: routeFareYen },
      { label: "介助・サービス料金小計", amountYen: careOptionFareYen },
      {
        label: buildWaitingEscortFareDisplayLabel({
          kind: 'waiting',
          elapsedSeconds: waitingSeconds,
          prepaidUnits: waitingPrepaidUnits,
          unitSeconds: (settings.waitingFare ?? waitingFareSettings).unitSeconds,
        }),
        amountYen: waitingFareYen,
      },
      {
        label: buildWaitingEscortFareDisplayLabel({
          kind: 'escort',
          elapsedSeconds: escortSeconds,
          prepaidUnits: escortPrepaidUnits,
          unitSeconds: (settings.escortFare ?? escortFareSettings).unitSeconds,
        }),
        amountYen: escortFareYen,
      },
      { label: "実費", amountYen: expenseFareYen },
      { label: discountName, amountYen: -disabilityDiscountAmount },
      { label: "タクシー券", amountYen: -taxiTicketAmountYen },
    ],
    meterMode: "fixed",
    timeMeter: null,
    originalConfirmedFareYen,
    additionalRouteFareYen: routeFareYen,
    additionalCareFareYen: careOptionFareYen,
  };
}

export function calculateFareIncreaseProgress(
  distanceKm: number,
  settings: BasicFareSettings = basicFareSettings,
) {
  if (distanceKm <= 0) {
    return {
      progressRate: 0,
      remainingDistanceKm: settings.initialDistanceKm,
      nextIncreaseYen: settings.initialFareYen,
    };
  }

  if (distanceKm < settings.initialDistanceKm) {
    return {
      progressRate: Math.min(distanceKm / settings.initialDistanceKm, 1),
      remainingDistanceKm: settings.initialDistanceKm - distanceKm,
      nextIncreaseYen: settings.initialFareYen,
    };
  }

  const distanceAfterInitial = distanceKm - settings.initialDistanceKm;
  const distanceIntoCurrentUnit =
    distanceAfterInitial % settings.additionalDistanceKm;
  const remainingDistanceKm =
    settings.additionalDistanceKm - distanceIntoCurrentUnit;

  return {
    progressRate: Math.min(
      distanceIntoCurrentUnit / settings.additionalDistanceKm,
      1,
    ),
    remainingDistanceKm,
    nextIncreaseYen: settings.additionalFareYen,
  };
}
