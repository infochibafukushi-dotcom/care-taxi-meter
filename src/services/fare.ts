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

export type CareOptionMasterItem = {
  id: string;
  name: string;
  defaultAmountYen: number;
};

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

export type FareBreakdown = {
  basicFareYen: number;
  waitingFareYen: number;
  escortFareYen: number;
  careOptionFareYen: number;
  expenseFareYen: number;
  totalFareYen: number;
  lineItems: FareLineItem[];
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

export const careOptionMaster: CareOptionMasterItem[] = [
  { id: "basic-care", name: "基本介助", defaultAmountYen: 500 },
  { id: "indoor", name: "室内介助", defaultAmountYen: 500 },
  { id: "stairs", name: "階段介助", defaultAmountYen: 1000 },
  { id: "wheelchair", name: "車椅子介助", defaultAmountYen: 500 },
  { id: "stretcher", name: "ストレッチャー", defaultAmountYen: 1500 },
  { id: "reclining", name: "リクライニング", defaultAmountYen: 1000 },
  { id: "other-care", name: "その他", defaultAmountYen: 500 },
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

export const DEFAULT_BASIC_FARE_SETTINGS = basicFareSettings;
export const DEFAULT_WAITING_FARE_SETTINGS = waitingFareSettings;
export const DEFAULT_ACCOMPANIMENT_FARE_SETTINGS = escortFareSettings;

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

export function calculateWaitingFareYen(elapsedSeconds: number) {
  return calculateTimeFareYen(elapsedSeconds, waitingFareSettings);
}

export function calculateAccompanimentFareYen(elapsedSeconds: number) {
  return calculateTimeFareYen(elapsedSeconds, escortFareSettings);
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

export function calculateFareBreakdown({
  distanceKm,
  waitingSeconds,
  escortSeconds,
  careOptions,
  expenses,
  settings = {},
}: {
  distanceKm: number;
  waitingSeconds: number;
  escortSeconds: number;
  careOptions: Array<{ amountYen: number }>;
  expenses: Array<{ amountYen: number }>;
  settings?: {
    basicFare?: BasicFareSettings;
    escortFare?: TimeFareSettings;
    waitingFare?: TimeFareSettings;
  };
}): FareBreakdown {
  const basicFareYen = calculateBasicFareYen(
    distanceKm,
    settings.basicFare ?? basicFareSettings,
  );
  const waitingFareYen = calculateTimeFareYen(
    waitingSeconds,
    settings.waitingFare ?? waitingFareSettings,
  );
  const escortFareYen = calculateTimeFareYen(
    escortSeconds,
    settings.escortFare ?? escortFareSettings,
  );
  const careOptionFareYen = calculateCareOptionTotalYen(careOptions);
  const expenseFareYen = calculateExpenseTotalYen(expenses);
  const totalFareYen =
    basicFareYen +
    waitingFareYen +
    escortFareYen +
    careOptionFareYen +
    expenseFareYen;

  return {
    basicFareYen,
    waitingFareYen,
    escortFareYen,
    careOptionFareYen,
    expenseFareYen,
    totalFareYen,
    lineItems: [
      { label: "基本運賃", amountYen: basicFareYen },
      { label: "待機料金", amountYen: waitingFareYen },
      { label: "院内付き添い料金", amountYen: escortFareYen },
      { label: "介助料金", amountYen: careOptionFareYen },
      { label: "実費", amountYen: expenseFareYen },
    ],
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

export function formatFareYen(fareYen: number) {
  return fareYen.toLocaleString("ja-JP");
}
