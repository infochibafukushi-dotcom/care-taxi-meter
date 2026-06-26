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
};

export const basicFareSettings: BasicFareSettings = {
  initialDistanceKm: 1.096,
  initialFareYen: 500,
  additionalDistanceKm: 0.255,
  additionalFareYen: 100,
};

export const waitingFareSettings: TimeFareSettings = {
  unitSeconds: 1800,
  unitFareYen: 100,
};

export const escortFareSettings: TimeFareSettings = {
  unitSeconds: 1800,
  unitFareYen: 300,
};

export const meterTimeFareSettings: MeterTimeFareSettings = {
  lowSpeedThresholdKmh: 10,
  unitSeconds: 90,
  unitFareYen: 90,
};

export const dispatchMenuMaster: DispatchMenuItem[] = [
  { id: "reservedPickup", name: "予約迎車", amount: 800, enabled: true, sortOrder: 1 },
];

export const specialVehicleMenuMaster: SpecialVehicleMenuItem[] = [
  { id: "oneBoxLift", name: "1BOXリフト車両", amount: 1000, enabled: true, sortOrder: 1 },
];

export const careOptionMaster: CareOptionMasterItem[] = [
  { id: "basicAssist", name: "基本介助", amount: 500, enabled: true, sortOrder: 1 },
  { id: "indoorAssist", name: "室内介助", amount: 500, enabled: true, sortOrder: 2 },
  { id: "stairsAssist", name: "階段介助", amount: 1000, enabled: true, sortOrder: 3 },
  { id: "wheelchairAssist", name: "車椅子介助", amount: 500, enabled: true, sortOrder: 4 },
  { id: "stretcherAssist", name: "ストレッチャー", amount: 1500, enabled: true, sortOrder: 5 },
  { id: "recliningAssist", name: "リクライニング", amount: 1000, enabled: true, sortOrder: 6 },
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
  name: "割引",
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
        { label: '待機/付き添い料金', amountYen: waitingFareYen + escortFareYen },
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
      { label: "待機/付き添い料金", amountYen: waitingFareYen + escortFareYen },
      { label: "実費", amountYen: expenseFareYen },
    ],
    meterMode,
    timeMeter: null,
  };
}

export function buildFixedFareBreakdown({
  confirmedFareYen,
  dispatchCharges = [],
  specialVehicleCharges = [],
  careOptions,
  customFees = [],
  expenses,
  waitingSeconds = 0,
  escortSeconds = 0,
  isDisabilityDiscount = false,
  taxiTickets = [],
  settings = {},
}: {
  confirmedFareYen: number;
  dispatchCharges?: Array<{ amountYen: number }>;
  specialVehicleCharges?: Array<{ amountYen: number }>;
  careOptions: Array<{ amountYen: number }>;
  customFees?: Array<{ amount: number }>;
  expenses: Array<{ amountYen: number }>;
  waitingSeconds?: number;
  escortSeconds?: number;
  isDisabilityDiscount?: boolean;
  taxiTickets?: Array<{ amount: number }>;
  settings?: {
    waitingFare?: TimeFareSettings;
    escortFare?: TimeFareSettings;
    discount?: DiscountSettings;
  };
}): FareBreakdown {
  const baseFareYen = Math.max(Math.round(confirmedFareYen), 0);
  const dispatchFareYen = calculateCareOptionTotalYen(dispatchCharges);
  const specialVehicleFareYen = calculateCareOptionTotalYen(specialVehicleCharges);
  const waitingFareYen = calculateTimeFareYen(
    waitingSeconds,
    settings.waitingFare ?? waitingFareSettings,
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
  const discountableFareYen = baseFareYen;
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
  const otherChargesYen =
    dispatchFareYen +
    specialVehicleFareYen +
    waitingFareYen +
    escortFareYen +
    careOptionFareYen +
    customFeeFareYen +
    expenseFareYen;
  const grossFareYen = discountableFareYen + otherChargesYen;
  const totalFareYen = Math.max(
    discountedBaseFareYen - taxiTicketAmountYen + otherChargesYen,
    0,
  );

  return {
    dispatchFareYen,
    specialVehicleFareYen,
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
    lineItems: [
      { label: "事前確定運賃", amountYen: baseFareYen },
      { label: discountName, amountYen: -disabilityDiscountAmount },
      { label: "タクシー券", amountYen: -taxiTicketAmountYen },
      { label: "予約・迎車料金", amountYen: dispatchFareYen },
      { label: "特殊車両料金", amountYen: specialVehicleFareYen },
      { label: "介助料金", amountYen: careOptionFareYen },
      ...(customFeeFareYen > 0
        ? [{ label: "その他", amountYen: customFeeFareYen }]
        : []),
      { label: "待機/付き添い料金", amountYen: waitingFareYen + escortFareYen },
      { label: "実費", amountYen: expenseFareYen },
    ],
    meterMode: "fixed",
    timeMeter: null,
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
