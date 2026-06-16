import type { MeterMode } from '../types/case'
import type { TimeMeterSettings } from './meterSettings'
import { calculateTimeMeterFare } from './timeMeterFare'

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
  expenseFareYen: number;
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
  { id: "otherAssist", name: "その他", amount: 500, enabled: true, sortOrder: 7 },
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
  expenses,
  isDisabilityDiscount = false,
  taxiTickets = [],
  settings = {},
  meterMode = 'gps',
  drivingSeconds = 0,
  timeMeterSettings,
}: {
  distanceKm: number;
  waitingSeconds: number;
  escortSeconds: number;
  meterTimeSeconds?: number;
  dispatchCharges?: Array<{ amountYen: number }>;
  specialVehicleCharges?: Array<{ amountYen: number }>;
  careOptions: Array<{ amountYen: number }>;
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
      expenseFareYen;
    const grossFareYen = discountableFareYen + otherChargesYen;
    const totalFareYen = Math.max(
      discountedMeterFareYen - taxiTicketAmountYen + otherChargesYen,
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
      expenseFareYen,
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
        { label: '介助料金', amountYen: careOptionFareYen },
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
    expenseFareYen;
  const grossFareYen = discountableFareYen + otherChargesYen;
  const totalFareYen = Math.max(
    discountedMeterFareYen - taxiTicketAmountYen + otherChargesYen,
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
    expenseFareYen,
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
      { label: discountName, amountYen: -disabilityDiscountAmount },
      { label: "タクシー券", amountYen: -taxiTicketAmountYen },
      { label: "予約・迎車料金", amountYen: dispatchFareYen },
      { label: "特殊車両料金", amountYen: specialVehicleFareYen },
      { label: "介助料金", amountYen: careOptionFareYen },
      { label: "待機/付き添い料金", amountYen: waitingFareYen + escortFareYen },
      { label: "実費", amountYen: expenseFareYen },
    ],
    meterMode,
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
