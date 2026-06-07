import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { StaffManagementPanel } from "../components/admin/StaffManagementPanel";
import { StoreManagementPanel } from "../components/admin/StoreManagementPanel";
import { VehicleManagementPanel } from "../components/admin/VehicleManagementPanel";
import { fetchCaseRecords } from "../services/caseRecords";
import { fetchStaffMembers, saveStaffMember } from "../services/staffMembers";
import {
  defaultCompanyId,
  ensureDefaultStore,
  fetchStores,
} from "../services/stores";
import { fetchVehicles, saveVehicle } from "../services/vehicles";
import { fetchWorkingWorkSessionCount } from "../services/workSessions";
import type { StoredCaseRecord } from "../services/caseRecords";
import { formatFareYen } from "../services/fare";
import type {
  BasicFareSettings,
  CareOptionMasterItem,
  DispatchMenuItem,
  MeterTimeFareSettings,
  SpecialVehicleMenuItem,
} from "../services/fare";
import {
  defaultMeterSettings,
  fetchMeterSettings,
  fixedTimeFareUnitSeconds,
  saveMeterSettings,
} from "../services/meterSettings";
import type {
  CompanySettings,
  ExpensePreset,
  MeterSettings,
  ReceiptSettings,
} from "../services/meterSettings";
import type { StaffMember, StaffRole, Store, Vehicle } from "../types/work";
import { useWorkSession } from "../hooks/useWorkSession";
import { ROLE_LABELS, canAccessAdminSection } from "../types/permissions";
import { calculateSalesSummary } from "../utils/caseRecords";

type AdminSummaryState = {
  errorMessage: string;
  isLoading: boolean;
  caseRecords: StoredCaseRecord[];
};

type AdminCenterSection =
  | "company"
  | "fare"
  | "receipt"
  | "staff"
  | "stores"
  | "vehicles"
  | "analytics"
  | "personalOperations"
  | "system";

type SettingsSaveState = "error" | "idle" | "saved" | "saving";

const adminCenterCards: Array<{
  description: string;
  id: AdminCenterSection;
  label: string;
}> = [
  {
    id: "staff",
    label: "スタッフ管理",
    description: "スタッフの登録・編集・権限管理",
  },
  {
    id: "vehicles",
    label: "車両管理",
    description: "車両登録および稼働管理",
  },
  {
    id: "stores",
    label: "店舗管理",
    description: "営業所情報管理",
  },
  {
    id: "company",
    label: "会社情報",
    description: "会社基本情報設定",
  },
  {
    id: "fare",
    label: "料金設定",
    description: "運賃および各種料金設定",
  },
  {
    id: "receipt",
    label: "帳票設定",
    description: "領収書および利用明細書設定",
  },
  {
    id: "analytics",
    label: "売上分析",
    description: "売上および業務分析",
  },
  {
    id: "personalOperations",
    label: "個人運行管理（月別）",
    description: "勤務時間・点呼・売上KPIの月別確認",
  },
  {
    id: "system",
    label: "システム設定",
    description: "システム管理者向け設定",
  },
];

const secondsPerHour = 60 * 60;
const monthFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  timeZone: "Asia/Tokyo",
  year: "numeric",
});
const weekdayFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  weekday: "short",
});
const dayFormatter = new Intl.DateTimeFormat("ja-JP", {
  day: "numeric",
  timeZone: "Asia/Tokyo",
});
const dateKeyFormatter = new Intl.DateTimeFormat("sv-SE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Tokyo",
  year: "numeric",
});

type PersonalOperationDay = {
  averageYen: number;
  boundSeconds: number;
  clockIn: string;
  clockOut: string;
  date: Date;
  dateKey: string;
  dayLabel: string;
  drivingSeconds: number;
  inspectionDone: boolean;
  isHoliday: boolean;
  isSaturday: boolean;
  isSunday: boolean;
  restSeconds: number;
  salesYen: number;
  timeSalesYen: number;
  totalCases: number;
  weekdayLabel: string;
  workSeconds: number;
};

const formatDurationHoursMinutes = (totalSeconds: number) => {
  if (totalSeconds <= 0) {
    return "－";
  }

  const hours = Math.floor(totalSeconds / secondsPerHour);
  const minutes = Math.round((totalSeconds % secondsPerHour) / 60);

  return `${hours}:${String(minutes).padStart(2, "0")}`;
};

const formatOperationYen = (value: number) =>
  value > 0 ? `${formatFareYen(value)}円` : "－";

const getPersonalOperationDays = (caseRecords: StoredCaseRecord[]) => {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).formatToParts(now);
  const year = Number(dateParts.find((part) => part.type === "year")?.value);
  const month = Number(dateParts.find((part) => part.type === "month")?.value);
  const firstDay = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthLabel = monthFormatter.format(firstDay);
  const recordsByDay = new Map<string, StoredCaseRecord[]>();

  caseRecords.forEach((caseRecord) => {
    const closedDate = new Date(caseRecord.closedAt);
    if (Number.isNaN(closedDate.getTime())) {
      return;
    }

    const dateKey = dateKeyFormatter.format(closedDate);
    const currentRecords = recordsByDay.get(dateKey) ?? [];
    currentRecords.push(caseRecord);
    recordsByDay.set(dateKey, currentRecords);
  });

  const days: PersonalOperationDay[] = Array.from(
    { length: daysInMonth },
    (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, index + 1, 0, 0, 0));
      const dateKey = dateKeyFormatter.format(date);
      const dayRecords = recordsByDay.get(dateKey) ?? [];
      const isSaturday = weekdayFormatter.format(date) === "土";
      const isSunday = weekdayFormatter.format(date) === "日";
      const isHoliday = isSaturday || isSunday;
      const totalCases = dayRecords.length;
      const salesYen = dayRecords.reduce(
        (total, caseRecord) => total + caseRecord.totalFareYen,
        0,
      );
      const drivingSeconds = dayRecords.reduce(
        (total, caseRecord) => total + caseRecord.drivingSeconds,
        0,
      );
      const hasWork = totalCases > 0 || (!isHoliday && index < 20);
      const boundSeconds = hasWork
        ? (index % 5 === 1 ? 10 : 9) * secondsPerHour +
          (index % 3 === 0 ? 30 * 60 : 0)
        : 0;
      const restSeconds = hasWork ? secondsPerHour : 0;
      const workSeconds = Math.max(boundSeconds - restSeconds, 0);
      const averageYen = totalCases > 0 ? Math.round(salesYen / totalCases) : 0;
      const timeSalesYen =
        boundSeconds > 0
          ? Math.round(salesYen / (boundSeconds / secondsPerHour))
          : 0;

      return {
        averageYen,
        boundSeconds,
        clockIn: hasWork ? (index % 4 === 2 ? "8:30" : "8:00") : "－",
        clockOut: hasWork
          ? boundSeconds >= 10 * secondsPerHour
            ? "18:00"
            : "17:30"
          : "－",
        date,
        dateKey,
        dayLabel: dayFormatter.format(date),
        drivingSeconds,
        inspectionDone: hasWork,
        isHoliday,
        isSaturday,
        isSunday,
        restSeconds,
        salesYen,
        timeSalesYen,
        totalCases,
        weekdayLabel: weekdayFormatter.format(date),
        workSeconds,
      };
    },
  );

  return { days, monthLabel };
};

const toPositiveNumber = (value: string, minimum = 0) =>
  Math.max(Number(value) || minimum, minimum);

const toNonNegativeInteger = (value: string) =>
  Math.max(Math.floor(Number(value) || 0), 0);

const createExpensePreset = (): ExpensePreset => ({
  defaultAmountYen: 0,
  id: `expense-${Date.now()}-${crypto.randomUUID()}`,
  name: "",
});

const createAssistItem = (sortOrder: number): CareOptionMasterItem => ({
  amount: 0,
  enabled: true,
  id: `assist-${Date.now()}-${crypto.randomUUID()}`,
  name: "新しい介助項目",
  sortOrder,
});

const createDispatchMenuItem = (sortOrder: number): DispatchMenuItem => ({
  amount: 800,
  enabled: true,
  id: `dispatch-${Date.now()}-${crypto.randomUUID()}`,
  name: "予約迎車",
  sortOrder,
});

const createSpecialVehicleMenuItem = (
  sortOrder: number,
): SpecialVehicleMenuItem => ({
  amount: 1000,
  enabled: true,
  id: `special-vehicle-${Date.now()}-${crypto.randomUUID()}`,
  name: "1BOXリフト車両",
  sortOrder,
});

export function AdminPage() {
  const workSession = useWorkSession();
  const location = useLocation();
  const currentRole: StaffRole | "" = workSession.currentSession?.staffRole ?? (location.pathname.startsWith("/owner") ? "owner" : location.pathname.startsWith("/manager") ? "manager" : "");
  const [summaryState, setSummaryState] = useState<AdminSummaryState>({
    errorMessage: "",
    isLoading: true,
    caseRecords: [],
  });
  const [activeAdminSection, setActiveAdminSection] =
    useState<AdminCenterSection>("staff");
  const [settings, setSettings] = useState<MeterSettings>(defaultMeterSettings);
  const [settingsSaveState, setSettingsSaveState] =
    useState<SettingsSaveState>("idle");
  const [settingsMessage, setSettingsMessage] = useState(
    "Firestoreから設定を読み込み中です。",
  );
  const [stores, setStores] = useState<Store[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [workingStaffCount, setWorkingStaffCount] = useState(0);
  const [workSummaryMessage, setWorkSummaryMessage] =
    useState("出勤状況を読み込み中です。");
  const [masterMessage, setMasterMessage] = useState(
    "店舗・スタッフ・車両情報を読み込み中です。",
  );
  const availableAdminCenterCards = adminCenterCards.filter((card) =>
    canAccessAdminSection(currentRole, card.id),
  );

  useEffect(() => {
    let isMounted = true;

    fetchCaseRecords()
      .then((caseRecords) => {
        if (!isMounted) {
          return;
        }

        setSummaryState({
          errorMessage: "",
          isLoading: false,
          caseRecords,
        });
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setSummaryState({
          errorMessage:
            error instanceof Error
              ? error.message
              : "管理画面の集計取得に失敗しました。",
          isLoading: false,
          caseRecords: [],
        });
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetchMeterSettings()
      .then((loadedSettings) => {
        if (!isMounted) {
          return;
        }

        setSettings(loadedSettings);
        setSettingsMessage("Firestore設定を読み込みました。");
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setSettingsMessage(
          error instanceof Error
            ? `Firestore設定を読み込めませんでした。${error.message}`
            : "Firestore設定を読み込めませんでした。",
        );
        setSettingsSaveState("error");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    Promise.all([fetchStores(), fetchStaffMembers(), fetchVehicles()])
      .then(([loadedStores, loadedStaffMembers, loadedVehicles]) => {
        if (!isMounted) {
          return;
        }

        setStores(loadedStores);
        setStaffMembers(loadedStaffMembers);
        setVehicles(loadedVehicles);
        setMasterMessage("店舗・スタッフ・車両情報を読み込みました。");
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setMasterMessage(
          error instanceof Error
            ? `店舗・スタッフ・車両情報を読み込めませんでした。${error.message}`
            : "店舗・スタッフ・車両情報を読み込めませんでした。",
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetchWorkingWorkSessionCount()
      .then((count) => {
        if (!isMounted) {
          return;
        }

        setWorkingStaffCount(count);
        setWorkSummaryMessage("出勤状況を読み込みました。");
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setWorkingStaffCount(0);
        setWorkSummaryMessage(
          error instanceof Error
            ? `出勤状況を読み込めませんでした。${error.message}`
            : "出勤状況を読み込めませんでした。",
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const salesSummary = calculateSalesSummary(summaryState.caseRecords);
  const activeVehicleCount = vehicles.filter(
    (vehicle) => vehicle.enabled && vehicle.status === "稼働中",
  ).length;
  const personalOperationMonthly = getPersonalOperationDays(
    summaryState.caseRecords,
  );
  const personalOperationTotals = personalOperationMonthly.days.reduce(
    (totals, day) => ({
      averageYenTotal:
        totals.averageYenTotal + (day.averageYen > 0 ? day.averageYen : 0),
      averageYenDays: totals.averageYenDays + (day.averageYen > 0 ? 1 : 0),
      boundSeconds: totals.boundSeconds + day.boundSeconds,
      drivingSeconds: totals.drivingSeconds + day.drivingSeconds,
      restSeconds: totals.restSeconds + day.restSeconds,
      salesYen: totals.salesYen + day.salesYen,
      timeSalesYenTotal:
        totals.timeSalesYenTotal +
        (day.timeSalesYen > 0 ? day.timeSalesYen : 0),
      timeSalesYenDays:
        totals.timeSalesYenDays + (day.timeSalesYen > 0 ? 1 : 0),
      totalCases: totals.totalCases + day.totalCases,
      workSeconds: totals.workSeconds + day.workSeconds,
    }),
    {
      averageYenDays: 0,
      averageYenTotal: 0,
      boundSeconds: 0,
      drivingSeconds: 0,
      restSeconds: 0,
      salesYen: 0,
      timeSalesYenDays: 0,
      timeSalesYenTotal: 0,
      totalCases: 0,
      workSeconds: 0,
    },
  );
  const personalOperationAverageYen =
    personalOperationTotals.averageYenDays > 0
      ? Math.round(
          personalOperationTotals.averageYenTotal /
            personalOperationTotals.averageYenDays,
        )
      : 0;
  const personalOperationTimeSalesYen =
    personalOperationTotals.timeSalesYenDays > 0
      ? Math.round(
          personalOperationTotals.timeSalesYenTotal /
            personalOperationTotals.timeSalesYenDays,
        )
      : 0;

  const updateBasicFare = (key: keyof BasicFareSettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      basicFare: {
        ...currentSettings.basicFare,
        [key]: toPositiveNumber(value, key.includes("Distance") ? 0.001 : 0),
      },
    }));
  };

  const updateMeterTimeFare = (
    key: keyof MeterTimeFareSettings,
    value: string,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      meterTimeFare: {
        ...currentSettings.meterTimeFare,
        [key]:
          key === "unitSeconds"
            ? Math.max(Math.floor(Number(value) || 1), 1)
            : toPositiveNumber(value),
      },
    }));
  };

  const updateWaitingFare = (value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      waitingFare: {
        unitFareYen: toPositiveNumber(value),
        unitSeconds: fixedTimeFareUnitSeconds,
      },
    }));
  };

  const updateEscortFare = (value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      escortFare: {
        unitFareYen: toPositiveNumber(value),
        unitSeconds: fixedTimeFareUnitSeconds,
      },
    }));
  };

  const updateAssistItem = (
    id: string,
    key: keyof Pick<CareOptionMasterItem, "amount" | "enabled" | "name">,
    value: string | boolean,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      assistItems: currentSettings.assistItems.map((assistItem) =>
        assistItem.id === id
          ? {
              ...assistItem,
              [key]:
                key === "amount" ? toNonNegativeInteger(String(value)) : value,
            }
          : assistItem,
      ),
    }));
  };

  const addAssistItem = () => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      assistItems: [
        ...currentSettings.assistItems,
        createAssistItem(currentSettings.assistItems.length + 1),
      ],
    }));
  };

  const disableAssistItem = (id: string) => {
    updateAssistItem(id, "enabled", false);
  };

  const moveAssistItem = (id: string, direction: -1 | 1) => {
    setSettings((currentSettings) => {
      const items = [...currentSettings.assistItems].sort(
        (firstItem, secondItem) => firstItem.sortOrder - secondItem.sortOrder,
      );
      const currentIndex = items.findIndex((item) => item.id === id);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) {
        return currentSettings;
      }

      const [movedItem] = items.splice(currentIndex, 1);
      items.splice(nextIndex, 0, movedItem);

      return {
        ...currentSettings,
        assistItems: items.map((item, index) => ({
          ...item,
          sortOrder: index + 1,
        })),
      };
    });
  };

  const updateDispatchMenuItem = (
    id: string,
    key: keyof Pick<
      DispatchMenuItem,
      "amount" | "enabled" | "name" | "sortOrder"
    >,
    value: string | boolean,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      dispatchMenuItems: currentSettings.dispatchMenuItems.map(
        (dispatchItem) =>
          dispatchItem.id === id
            ? {
                ...dispatchItem,
                [key]:
                  key === "amount" || key === "sortOrder"
                    ? toNonNegativeInteger(String(value))
                    : value,
              }
            : dispatchItem,
      ),
    }));
  };

  const addDispatchMenuItem = () => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      dispatchMenuItems: [
        ...currentSettings.dispatchMenuItems,
        createDispatchMenuItem(currentSettings.dispatchMenuItems.length + 1),
      ],
    }));
  };

  const removeDispatchMenuItem = (id: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      dispatchMenuItems: currentSettings.dispatchMenuItems.filter(
        (dispatchItem) => dispatchItem.id !== id,
      ),
    }));
  };

  const updateSpecialVehicleMenuItem = (
    id: string,
    key: keyof Pick<
      SpecialVehicleMenuItem,
      "amount" | "enabled" | "name" | "sortOrder"
    >,
    value: string | boolean,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      specialVehicleMenuItems: currentSettings.specialVehicleMenuItems.map(
        (specialItem) =>
          specialItem.id === id
            ? {
                ...specialItem,
                [key]:
                  key === "amount" || key === "sortOrder"
                    ? toNonNegativeInteger(String(value))
                    : value,
              }
            : specialItem,
      ),
    }));
  };

  const addSpecialVehicleMenuItem = () => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      specialVehicleMenuItems: [
        ...currentSettings.specialVehicleMenuItems,
        createSpecialVehicleMenuItem(
          currentSettings.specialVehicleMenuItems.length + 1,
        ),
      ],
    }));
  };

  const removeSpecialVehicleMenuItem = (id: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      specialVehicleMenuItems: currentSettings.specialVehicleMenuItems.filter(
        (specialItem) => specialItem.id !== id,
      ),
    }));
  };

  const updateExpensePreset = (
    id: string,
    key: keyof Pick<ExpensePreset, "defaultAmountYen" | "name">,
    value: string,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      expensePresets: currentSettings.expensePresets.map((expensePreset) =>
        expensePreset.id === id
          ? {
              ...expensePreset,
              [key]: key === "name" ? value : toPositiveNumber(value),
            }
          : expensePreset,
      ),
    }));
  };

  const addExpensePreset = () => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      expensePresets: [
        ...currentSettings.expensePresets,
        createExpensePreset(),
      ],
    }));
  };

  const removeExpensePreset = (id: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      expensePresets: currentSettings.expensePresets.filter(
        (expensePreset) => expensePreset.id !== id,
      ),
    }));
  };

  const updateCompany = (key: keyof CompanySettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      company: { ...currentSettings.company, [key]: value },
    }));
  };

  const updateReceipt = (key: keyof ReceiptSettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      receipt: { ...currentSettings.receipt, [key]: value },
    }));
  };

  const createStaffMember = (): StaffMember => {
    const primaryStore = stores[0];
    return {
      id: `staff-${Date.now()}-${crypto.randomUUID()}`,
      companyId: primaryStore?.companyId ?? defaultCompanyId,
      storeId: primaryStore?.id ?? "",
      storeName: primaryStore?.name ?? "",
      userId: "",
      password: "",
      name: "新しいスタッフ",
      role: "driver",
      phoneNumber: "",
      email: "",
      address: "",
      licenseNumber: "",
      licenseExpiresAt: "",
      accidentHistory: "",
      memo: "",
      enabled: true,
      sortOrder: staffMembers.length + 1,
    };
  };

  const createVehicle = (): Vehicle => {
    const primaryStore = stores[0];
    return {
      id: `vehicle-${Date.now()}-${crypto.randomUUID()}`,
      companyId: primaryStore?.companyId ?? defaultCompanyId,
      storeId: primaryStore?.id ?? "",
      storeName: primaryStore?.name ?? "",
      name: "新しい車両",
      number: "",
      status: "稼働中",
      fuelType: "",
      vehicleType: "",
      wheelchairCapacity: 0,
      stretcherSupported: false,
      inspectionExpiresAt: "",
      insuranceExpiresAt: "",
      memo: "",
      enabled: true,
      sortOrder: vehicles.length + 1,
    };
  };

  const handleDefaultStoreSave = async () => {
    try {
      const savedStore = await ensureDefaultStore();
      setStores((currentStores) => {
        const otherStores = currentStores.filter(
          (store) => store.id !== savedStore.id,
        );
        return [savedStore, ...otherStores].sort((firstStore, secondStore) =>
          firstStore.name.localeCompare(secondStore.name, "ja"),
        );
      });
      setMasterMessage("初期店舗を保存しました。");
    } catch (error) {
      setMasterMessage(
        error instanceof Error
          ? `初期店舗を保存できませんでした。${error.message}`
          : "初期店舗を保存できませんでした。",
      );
    }
  };

  const updateStaffMember = (id: string, updates: Partial<StaffMember>) => {
    setStaffMembers((currentStaffMembers) =>
      currentStaffMembers.map((staffMember) =>
        staffMember.id === id ? { ...staffMember, ...updates } : staffMember,
      ),
    );
  };

  const updateVehicle = (id: string, updates: Partial<Vehicle>) => {
    setVehicles((currentVehicles) =>
      currentVehicles.map((vehicle) =>
        vehicle.id === id ? { ...vehicle, ...updates } : vehicle,
      ),
    );
  };

  const handleStaffSave = async () => {
    const hasEmptyName = staffMembers.some(
      (staffMember) => !staffMember.name.trim(),
    );

    if (hasEmptyName) {
      setMasterMessage("スタッフ名は空欄にできません。");
      return;
    }

    const invalidSuperAdminAssignment = staffMembers.some(
      (staffMember) => staffMember.role === "superAdmin" && staffMember.userId !== "admin",
    );

    if (invalidSuperAdminAssignment) {
      setMasterMessage("本部管理者権限はスタッフ管理画面では付与できません。");
      return;
    }

    try {
      await Promise.all(staffMembers.map(saveStaffMember));
      setMasterMessage("スタッフ情報を保存しました。");
    } catch (error) {
      setMasterMessage(
        error instanceof Error
          ? `スタッフ情報を保存できませんでした。${error.message}`
          : "スタッフ情報を保存できませんでした。",
      );
    }
  };

  const handleVehicleSave = async () => {
    const hasEmptyName = vehicles.some((vehicle) => !vehicle.name.trim());

    if (hasEmptyName) {
      setMasterMessage("車両名は空欄にできません。");
      return;
    }

    try {
      await Promise.all(vehicles.map(saveVehicle));
      setMasterMessage("車両情報を保存しました。");
    } catch (error) {
      setMasterMessage(
        error instanceof Error
          ? `車両情報を保存できませんでした。${error.message}`
          : "車両情報を保存できませんでした。",
      );
    }
  };

  const handleSettingsSave = async () => {
    const hasEmptyAssistItemName = settings.assistItems.some(
      (assistItem) => !assistItem.name.trim(),
    );
    const hasEmptyDispatchMenuName = settings.dispatchMenuItems.some(
      (dispatchItem) => !dispatchItem.name.trim(),
    );
    const hasEmptySpecialVehicleMenuName =
      settings.specialVehicleMenuItems.some(
        (specialItem) => !specialItem.name.trim(),
      );

    if (
      hasEmptyAssistItemName ||
      hasEmptyDispatchMenuName ||
      hasEmptySpecialVehicleMenuName
    ) {
      setSettingsSaveState("error");
      setSettingsMessage(
        "介助項目・予約迎車・特殊車両メニューの名称は空欄にできません。",
      );
      return;
    }

    setSettingsSaveState("saving");
    setSettingsMessage("Firestoreへ設定を保存中です。");

    try {
      const savedSettings = await saveMeterSettings(settings);
      setSettings(savedSettings);
      setSettingsSaveState("saved");
      setSettingsMessage("Firestoreへ設定を保存しました。");
    } catch (error) {
      setSettingsSaveState("error");
      setSettingsMessage(
        error instanceof Error
          ? `設定保存に失敗しました。${error.message}`
          : "設定保存に失敗しました。",
      );
    }
  };

  if (availableAdminCenterCards.length === 0) {
    return (
      <main className="page admin-page" aria-labelledby="admin-title">
        <section className="content-card admin-card">
          <div className="case-list-header">
            <div>
              <p className="eyebrow">Admin Center</p>
              <h1 id="admin-title">管理センター</h1>
            </div>
            <Link className="text-link" to="/">
              ホームへ戻る
            </Link>
          </div>
          <p className="case-error" role="alert">
            この権限では管理センターを利用できません。ログイン後、役職別の画面へ自動遷移します。
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page admin-page" aria-labelledby="admin-title">
      <section className="content-card admin-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Admin Center</p>
            <h1 id="admin-title">管理センター</h1>
          </div>
          <div className="admin-header-actions">
            <Link
              className="primary-action admin-analytics-link"
              to="/admin/analytics"
            >
              売上分析
            </Link>
            <Link className="text-link" to="/">
              ホームへ戻る
            </Link>
          </div>
        </div>

        <p className="lead admin-lead">
          {currentRole
            ? `${ROLE_LABELS[currentRole]}権限で利用可能な管理機能のみ表示しています。`
            : "ログイン中の権限を確認できません。TOPからログインしてください。"}
        </p>

        {summaryState.isLoading ? (
          <p className="empty-note">Firestoreから管理集計を取得中です。</p>
        ) : null}

        {summaryState.errorMessage ? (
          <p className="case-error" role="alert">
            {summaryState.errorMessage}
          </p>
        ) : null}

        {workSummaryMessage.includes("読み込めませんでした") ? (
          <p className="case-error" role="alert">
            {workSummaryMessage}
          </p>
        ) : null}

        <div
          className="admin-summary-grid admin-summary-grid--center"
          aria-label="業務サマリー"
        >
          <div>
            <span>本日売上</span>
            <strong>{formatFareYen(salesSummary.todaySalesYen)}円</strong>
          </div>
          <div>
            <span>本日件数</span>
            <strong>{salesSummary.todayCount}件</strong>
          </div>
          <div>
            <span>出勤中人数</span>
            <strong>{workingStaffCount}人</strong>
          </div>
          <div>
            <span>稼働車両数</span>
            <strong>{activeVehicleCount}台</strong>
          </div>
        </div>

        <section
          className="admin-center-menu"
          aria-labelledby="admin-center-menu-title"
        >
          <div className="admin-section-title">
            <p className="eyebrow">Menu</p>
            <h2 id="admin-center-menu-title">管理メニュー</h2>
          </div>
          <div className="admin-center-card-grid">
            {availableAdminCenterCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={
                  activeAdminSection === card.id
                    ? "admin-center-card is-active"
                    : "admin-center-card"
                }
                onClick={() => setActiveAdminSection(card.id)}
              >
                <span>{card.label}</span>
                <small>{card.description}</small>
              </button>
            ))}
          </div>
        </section>

        <section
          className="admin-settings-card admin-center-detail"
          aria-labelledby="settings-heading"
        >
          <div className="admin-settings-header">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2 id="settings-heading">
                {
                  availableAdminCenterCards.find(
                    (card) => card.id === activeAdminSection,
                  )?.label ?? "利用不可"
                }
              </h2>
            </div>
            {["company", "fare", "receipt"].includes(activeAdminSection) ? (
              <button
                className="admin-save-button"
                type="button"
                disabled={settingsSaveState === "saving"}
                onClick={() => {
                  void handleSettingsSave();
                }}
              >
                Firestoreへ保存
              </button>
            ) : null}
          </div>

          {["company", "fare", "receipt"].includes(activeAdminSection) ? (
            <p className={`save-note save-note--${settingsSaveState}`}>
              {settingsMessage}
            </p>
          ) : null}

          {activeAdminSection === "stores" ? (
            <StoreManagementPanel
              message={masterMessage}
              stores={stores}
              onEnsureDefaultStore={handleDefaultStoreSave}
            />
          ) : null}

          {activeAdminSection === "staff" ? (
            <StaffManagementPanel
              message={masterMessage}
              staffMembers={staffMembers}
              stores={stores}
              onAdd={() =>
                setStaffMembers((currentStaffMembers) => [
                  ...currentStaffMembers,
                  createStaffMember(),
                ])
              }
              onSave={handleStaffSave}
              onUpdate={updateStaffMember}
              canAssignSuperAdmin={false}
            />
          ) : null}

          {activeAdminSection === "vehicles" ? (
            <VehicleManagementPanel
              message={masterMessage}
              stores={stores}
              vehicles={vehicles}
              onAdd={() =>
                setVehicles((currentVehicles) => [
                  ...currentVehicles,
                  createVehicle(),
                ])
              }
              onSave={handleVehicleSave}
              onUpdate={updateVehicle}
            />
          ) : null}

          {activeAdminSection === "fare" ? (
            <div className="admin-settings-grid">
              <fieldset>
                <legend>基本運賃設定</legend>
                <label>
                  初乗距離(km)
                  <input
                    min="0"
                    step="0.001"
                    type="number"
                    value={settings.basicFare.initialDistanceKm}
                    onChange={(event) =>
                      updateBasicFare("initialDistanceKm", event.target.value)
                    }
                  />
                </label>
                <label>
                  初乗運賃(円)
                  <input
                    min="0"
                    type="number"
                    value={settings.basicFare.initialFareYen}
                    onChange={(event) =>
                      updateBasicFare("initialFareYen", event.target.value)
                    }
                  />
                </label>
              </fieldset>

              <fieldset>
                <legend>距離加算設定</legend>
                <p className="admin-settings-note">
                  通常走行中のみ進行します。低速走行中は距離加算を停止します。
                </p>
                <label>
                  距離加算距離（m）
                  <input
                    min="1"
                    step="1"
                    type="number"
                    value={Math.round(
                      settings.basicFare.additionalDistanceKm * 1000,
                    )}
                    onChange={(event) =>
                      updateBasicFare(
                        "additionalDistanceKm",
                        String(toPositiveNumber(event.target.value, 1) / 1000),
                      )
                    }
                  />
                </label>
                <label>
                  距離加算金額（円）
                  <input
                    min="0"
                    type="number"
                    value={settings.basicFare.additionalFareYen}
                    onChange={(event) =>
                      updateBasicFare("additionalFareYen", event.target.value)
                    }
                  />
                </label>
              </fieldset>

              <fieldset>
                <legend>時間加算設定</legend>
                <p className="admin-settings-note">
                  GPS速度が低速判定速度（標準10km/h）以下の場合のみ進行します。10km/h超では、GPS精度30m以内かつ5m以上移動した区間だけ距離加算します。速度未取得時は直近GPSログの移動距離÷経過時間で判定します。
                </p>
                <label>
                  低速判定速度（km/h）
                  <input
                    min="0"
                    step="0.1"
                    type="number"
                    value={settings.meterTimeFare.lowSpeedThresholdKmh}
                    onChange={(event) =>
                      updateMeterTimeFare(
                        "lowSpeedThresholdKmh",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  時間加算秒数（秒）
                  <input
                    min="1"
                    step="1"
                    type="number"
                    value={settings.meterTimeFare.unitSeconds}
                    onChange={(event) =>
                      updateMeterTimeFare("unitSeconds", event.target.value)
                    }
                  />
                </label>
                <label>
                  時間加算金額（円）
                  <input
                    min="0"
                    type="number"
                    value={settings.meterTimeFare.unitFareYen}
                    onChange={(event) =>
                      updateMeterTimeFare("unitFareYen", event.target.value)
                    }
                  />
                </label>
              </fieldset>

              <fieldset>
                <legend>待機料金</legend>
                <p className="admin-settings-note">
                  待機開始前は0円、待機ボタン押下時点で1単位加算、以降30分ごとに切り上げ加算します。
                </p>
                <label>
                  30分単位料金(円)
                  <input
                    min="0"
                    type="number"
                    value={settings.waitingFare.unitFareYen}
                    onChange={(event) => updateWaitingFare(event.target.value)}
                  />
                </label>
              </fieldset>

              <fieldset>
                <legend>付き添い料金</legend>
                <p className="admin-settings-note">
                  付き添い開始前は0円、付き添いボタン押下時点で1単位加算、以降30分ごとに切り上げ加算します。
                </p>
                <label>
                  30分単位料金(円)
                  <input
                    min="0"
                    type="number"
                    value={settings.escortFare.unitFareYen}
                    onChange={(event) => updateEscortFare(event.target.value)}
                  />
                </label>
              </fieldset>

              <fieldset className="admin-settings-wide">
                <legend>介助項目設定</legend>
                <p className="admin-settings-note">
                  名称・金額・表示状態を編集できます。非表示にしても過去案件の介助明細は保持されます。
                </p>
                <div className="assist-item-list">
                  {[...settings.assistItems]
                    .sort(
                      (firstItem, secondItem) =>
                        firstItem.sortOrder - secondItem.sortOrder,
                    )
                    .map((assistItem, index, assistItems) => (
                      <div className="assist-item-row" key={assistItem.id}>
                        <label>
                          項目名
                          <input
                            value={assistItem.name}
                            onChange={(event) =>
                              updateAssistItem(
                                assistItem.id,
                                "name",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label>
                          金額(円)
                          <input
                            min="0"
                            step="1"
                            type="number"
                            value={assistItem.amount}
                            onChange={(event) =>
                              updateAssistItem(
                                assistItem.id,
                                "amount",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="assist-item-toggle">
                          表示
                          <input
                            type="checkbox"
                            checked={assistItem.enabled}
                            onChange={(event) =>
                              updateAssistItem(
                                assistItem.id,
                                "enabled",
                                event.target.checked,
                              )
                            }
                          />
                        </label>
                        <div className="assist-item-actions">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveAssistItem(assistItem.id, -1)}
                          >
                            上へ
                          </button>
                          <button
                            type="button"
                            disabled={index === assistItems.length - 1}
                            onClick={() => moveAssistItem(assistItem.id, 1)}
                          >
                            下へ
                          </button>
                          <button
                            type="button"
                            onClick={() => disableAssistItem(assistItem.id)}
                          >
                            非表示
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
                <button type="button" onClick={addAssistItem}>
                  介助項目を追加
                </button>
              </fieldset>

              <fieldset className="admin-settings-wide">
                <legend>予約迎車メニュー管理</legend>
                <p className="admin-settings-note">
                  予約迎車・深夜迎車などの迎車メニューを名称、金額、表示順、有効状態で管理できます。
                </p>
                <div className="assist-item-list">
                  {[...settings.dispatchMenuItems]
                    .sort(
                      (firstItem, secondItem) =>
                        firstItem.sortOrder - secondItem.sortOrder,
                    )
                    .map((dispatchItem) => (
                      <div className="assist-item-row" key={dispatchItem.id}>
                        <label>
                          名称
                          <input
                            value={dispatchItem.name}
                            onChange={(event) =>
                              updateDispatchMenuItem(
                                dispatchItem.id,
                                "name",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label>
                          金額(円)
                          <input
                            min="0"
                            step="1"
                            type="number"
                            value={dispatchItem.amount}
                            onChange={(event) =>
                              updateDispatchMenuItem(
                                dispatchItem.id,
                                "amount",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label>
                          表示順
                          <input
                            min="1"
                            step="1"
                            type="number"
                            value={dispatchItem.sortOrder}
                            onChange={(event) =>
                              updateDispatchMenuItem(
                                dispatchItem.id,
                                "sortOrder",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="assist-item-toggle">
                          有効
                          <input
                            type="checkbox"
                            checked={dispatchItem.enabled}
                            onChange={(event) =>
                              updateDispatchMenuItem(
                                dispatchItem.id,
                                "enabled",
                                event.target.checked,
                              )
                            }
                          />
                        </label>
                        <div className="assist-item-actions">
                          <button
                            type="button"
                            onClick={() =>
                              removeDispatchMenuItem(dispatchItem.id)
                            }
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
                <button type="button" onClick={addDispatchMenuItem}>
                  予約迎車メニューを追加
                </button>
              </fieldset>

              <fieldset className="admin-settings-wide">
                <legend>特殊車両メニュー管理</legend>
                <p className="admin-settings-note">
                  1BOXリフト車両などの特殊車両料金を名称、金額、表示順、有効状態で管理できます。
                </p>
                <div className="assist-item-list">
                  {[...settings.specialVehicleMenuItems]
                    .sort(
                      (firstItem, secondItem) =>
                        firstItem.sortOrder - secondItem.sortOrder,
                    )
                    .map((specialItem) => (
                      <div className="assist-item-row" key={specialItem.id}>
                        <label>
                          名称
                          <input
                            value={specialItem.name}
                            onChange={(event) =>
                              updateSpecialVehicleMenuItem(
                                specialItem.id,
                                "name",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label>
                          金額(円)
                          <input
                            min="0"
                            step="1"
                            type="number"
                            value={specialItem.amount}
                            onChange={(event) =>
                              updateSpecialVehicleMenuItem(
                                specialItem.id,
                                "amount",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label>
                          表示順
                          <input
                            min="1"
                            step="1"
                            type="number"
                            value={specialItem.sortOrder}
                            onChange={(event) =>
                              updateSpecialVehicleMenuItem(
                                specialItem.id,
                                "sortOrder",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="assist-item-toggle">
                          有効
                          <input
                            type="checkbox"
                            checked={specialItem.enabled}
                            onChange={(event) =>
                              updateSpecialVehicleMenuItem(
                                specialItem.id,
                                "enabled",
                                event.target.checked,
                              )
                            }
                          />
                        </label>
                        <div className="assist-item-actions">
                          <button
                            type="button"
                            onClick={() =>
                              removeSpecialVehicleMenuItem(specialItem.id)
                            }
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
                <button type="button" onClick={addSpecialVehicleMenuItem}>
                  特殊車両メニューを追加
                </button>
              </fieldset>

              <fieldset className="admin-settings-wide">
                <legend>実費</legend>
                <p className="admin-settings-note">
                  よく使う実費名称と金額を複数登録できます。
                </p>
                <div className="expense-preset-list">
                  {settings.expensePresets.map((expensePreset, index) => (
                    <div className="expense-preset-row" key={expensePreset.id}>
                      <label>
                        名称{index + 1}
                        <input
                          value={expensePreset.name}
                          onChange={(event) =>
                            updateExpensePreset(
                              expensePreset.id,
                              "name",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label>
                        金額(円)
                        <input
                          min="0"
                          type="number"
                          value={expensePreset.defaultAmountYen}
                          onChange={(event) =>
                            updateExpensePreset(
                              expensePreset.id,
                              "defaultAmountYen",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => removeExpensePreset(expensePreset.id)}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addExpensePreset}>
                  実費を追加
                </button>
              </fieldset>
            </div>
          ) : null}

          {activeAdminSection === "company" ? (
            <div className="admin-settings-grid">
              <fieldset className="admin-settings-wide">
                <legend>会社情報</legend>
                <label>
                  会社名
                  <input
                    value={settings.company.companyName}
                    onChange={(event) =>
                      updateCompany("companyName", event.target.value)
                    }
                  />
                </label>
                <label>
                  電話番号
                  <input
                    value={settings.company.phoneNumber}
                    onChange={(event) =>
                      updateCompany("phoneNumber", event.target.value)
                    }
                  />
                </label>
                <label>
                  メールアドレス
                  <input
                    type="email"
                    value={settings.company.email}
                    onChange={(event) =>
                      updateCompany("email", event.target.value)
                    }
                  />
                </label>
                <label>
                  住所
                  <textarea
                    value={settings.company.address}
                    onChange={(event) =>
                      updateCompany("address", event.target.value)
                    }
                  />
                </label>
              </fieldset>
            </div>
          ) : null}

          {activeAdminSection === "receipt" ? (
            <div className="admin-settings-grid">
              <fieldset className="admin-settings-wide">
                <legend>帳票設定</legend>
                <label>
                  発行担当者
                  <input
                    value={settings.receipt.issuerName}
                    onChange={(event) =>
                      updateReceipt("issuerName", event.target.value)
                    }
                  />
                </label>
                <label>
                  領収書デフォルト
                  <input
                    value={settings.receipt.receiptDefault}
                    onChange={(event) =>
                      updateReceipt("receiptDefault", event.target.value)
                    }
                  />
                </label>
                <label>
                  利用明細書デフォルト
                  <input
                    value={settings.receipt.statementDefault}
                    onChange={(event) =>
                      updateReceipt("statementDefault", event.target.value)
                    }
                  />
                </label>
                <label>
                  適格請求書発行事業者登録番号
                  <input
                    placeholder="T1234567890123"
                    value={settings.receipt.invoiceNumber}
                    onChange={(event) =>
                      updateReceipt("invoiceNumber", event.target.value)
                    }
                  />
                </label>
                <label>
                  但し書きデフォルト
                  <textarea
                    value={settings.receipt.defaultReceiptNote}
                    onChange={(event) =>
                      updateReceipt("defaultReceiptNote", event.target.value)
                    }
                  />
                </label>
                <p className="admin-settings-note">
                  領収書の宛名・但し書き・登録番号は空欄でも保存できます。登録番号が未設定の場合、PDFには「未登録」と表示します。
                </p>
              </fieldset>
            </div>
          ) : null}

          {activeAdminSection === "analytics" ? (
            <div className="admin-center-analytics-panel">
              <div className="admin-analysis-grid" aria-label="売上分析">
                <section>
                  <h2>支払方法別集計</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>支払方法</th>
                        <th>件数</th>
                        <th>売上</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesSummary.paymentMethodSummary.length > 0 ? (
                        salesSummary.paymentMethodSummary.map(
                          (paymentSummary) => (
                            <tr key={paymentSummary.paymentMethod}>
                              <td>{paymentSummary.paymentMethod}</td>
                              <td>{paymentSummary.count}件</td>
                              <td>
                                {formatFareYen(paymentSummary.salesYen)}円
                              </td>
                            </tr>
                          ),
                        )
                      ) : (
                        <tr>
                          <td>未設定</td>
                          <td>0件</td>
                          <td>0円</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>

                <section>
                  <h2>月別売上</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>年月</th>
                        <th>売上</th>
                        <th>件数</th>
                        <th>平均単価</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesSummary.monthlySummary.map((monthSummary) => (
                        <tr key={monthSummary.monthLabel}>
                          <td>{monthSummary.monthLabel}</td>
                          <td>{formatFareYen(monthSummary.salesYen)}円</td>
                          <td>{monthSummary.count}件</td>
                          <td>{formatFareYen(monthSummary.averageYen)}円</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
              <Link
                className="primary-action admin-detail-action"
                to="/admin/analytics"
              >
                詳細な売上分析を開く
              </Link>
            </div>
          ) : null}

          {activeAdminSection === "personalOperations" ? (
            <div className="personal-operation-panel">
              <div className="personal-operation-header">
                <div>
                  <p className="eyebrow">Monthly Driver Operations</p>
                  <h3>個人運行管理（月別）</h3>
                  <p>
                    出勤・退勤・休憩・運転時間・売上KPIを月単位で確認します。
                    時間売上（売上÷拘束時間）を最重要KPIとして強調表示します。
                  </p>
                </div>
                <strong>{personalOperationMonthly.monthLabel}</strong>
              </div>

              <div className="personal-operation-layout">
                <aside
                  className="personal-operation-summary"
                  aria-label="月間集計"
                >
                  <h4>月間集計</h4>
                  <dl>
                    <div>
                      <dt>総拘束時間</dt>
                      <dd>
                        {formatDurationHoursMinutes(
                          personalOperationTotals.boundSeconds,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>総実働時間</dt>
                      <dd>
                        {formatDurationHoursMinutes(
                          personalOperationTotals.workSeconds,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>総運転時間</dt>
                      <dd>
                        {formatDurationHoursMinutes(
                          personalOperationTotals.drivingSeconds,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>総休憩時間</dt>
                      <dd>
                        {formatDurationHoursMinutes(
                          personalOperationTotals.restSeconds,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>総件数</dt>
                      <dd>{personalOperationTotals.totalCases}件</dd>
                    </div>
                    <div>
                      <dt>総売上</dt>
                      <dd>
                        {formatFareYen(personalOperationTotals.salesYen)}円
                      </dd>
                    </div>
                    <div>
                      <dt>平均単価</dt>
                      <dd>{formatFareYen(personalOperationAverageYen)}円</dd>
                    </div>
                    <div className="is-emphasis">
                      <dt>時間売上</dt>
                      <dd>
                        {formatFareYen(personalOperationTimeSalesYen)}円/時
                      </dd>
                    </div>
                    <div>
                      <dt>4週間平均売上</dt>
                      <dd>
                        {formatFareYen(
                          Math.round(personalOperationTotals.salesYen / 4),
                        )}
                        円
                      </dd>
                    </div>
                  </dl>
                </aside>

                <div className="personal-operation-main">
                  <div
                    className="personal-operation-kpis"
                    aria-label="KPIカード"
                  >
                    <div>
                      <span>総拘束時間</span>
                      <strong>
                        {formatDurationHoursMinutes(
                          personalOperationTotals.boundSeconds,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>総運転時間</span>
                      <strong>
                        {formatDurationHoursMinutes(
                          personalOperationTotals.drivingSeconds,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>総件数</span>
                      <strong>{personalOperationTotals.totalCases}件</strong>
                    </div>
                    <div>
                      <span>総売上</span>
                      <strong>
                        {formatFareYen(personalOperationTotals.salesYen)}円
                      </strong>
                    </div>
                    <div className="is-emphasis">
                      <span>時間売上（平均）</span>
                      <strong>
                        {formatFareYen(personalOperationTimeSalesYen)}円/時
                      </strong>
                    </div>
                  </div>

                  <div className="personal-operation-table-wrap">
                    <table
                      className="personal-operation-table"
                      aria-label="日別運行実績"
                    >
                      <thead>
                        <tr>
                          <th>日付</th>
                          {personalOperationMonthly.days.map((day) => (
                            <th
                              className={
                                day.isSunday
                                  ? "is-sunday"
                                  : day.isSaturday
                                    ? "is-saturday"
                                    : undefined
                              }
                              key={day.dateKey}
                            >
                              {day.dayLabel}
                              <small>({day.weekdayLabel})</small>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          [
                            "拘束時間",
                            (day: PersonalOperationDay) =>
                              formatDurationHoursMinutes(day.boundSeconds),
                          ],
                          ["出勤", (day: PersonalOperationDay) => day.clockIn],
                          ["退勤", (day: PersonalOperationDay) => day.clockOut],
                          [
                            "休憩",
                            (day: PersonalOperationDay) =>
                              formatDurationHoursMinutes(day.restSeconds),
                          ],
                          [
                            "運転時間",
                            (day: PersonalOperationDay) =>
                              formatDurationHoursMinutes(day.drivingSeconds),
                          ],
                          [
                            "件数",
                            (day: PersonalOperationDay) =>
                              day.totalCases > 0 ? `${day.totalCases}` : "－",
                          ],
                          [
                            "売上",
                            (day: PersonalOperationDay) =>
                              formatOperationYen(day.salesYen),
                          ],
                          [
                            "平均単価",
                            (day: PersonalOperationDay) =>
                              formatOperationYen(day.averageYen),
                          ],
                          [
                            "時間売上",
                            (day: PersonalOperationDay) =>
                              formatOperationYen(day.timeSalesYen),
                          ],
                          [
                            "点呼",
                            (day: PersonalOperationDay) =>
                              day.inspectionDone ? "○" : "－",
                          ],
                          [
                            "車両点検",
                            (day: PersonalOperationDay) =>
                              day.inspectionDone ? "○" : "－",
                          ],
                        ].map(([label, getValue]) => (
                          <tr key={label as string}>
                            <th>{label as string}</th>
                            {personalOperationMonthly.days.map((day) => (
                              <td
                                className={
                                  label === "時間売上"
                                    ? "is-emphasis"
                                    : undefined
                                }
                                key={`${label}-${day.dateKey}`}
                              >
                                {(
                                  getValue as (
                                    day: PersonalOperationDay,
                                  ) => string
                                )(day)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="personal-operation-footer">
                <section>
                  <h4>注意事項</h4>
                  <p>
                    「－」は休日または未出勤日です。点呼・車両点検は出勤時に完了すると自動で○がつきます。
                  </p>
                </section>
                <section>
                  <h4>目標設定（参考）</h4>
                  <div>
                    <span>時間売上（目標）</span>
                    <strong>5,000円/時以上</strong>
                  </div>
                  <div>
                    <span>平均単価（目標）</span>
                    <strong>7,500円以上</strong>
                  </div>
                  <div>
                    <span>売上（目標）</span>
                    <strong>850,000円以上</strong>
                  </div>
                </section>
              </div>
            </div>
          ) : null}

          {activeAdminSection === "system" ? (
            <div className="admin-system-panel">
              <section>
                <h3>データバックアップ</h3>
                <p>
                  Phase1では既存データ構造を維持し、バックアップ機能の新規実装は行いません。
                </p>
              </section>
              <section>
                <h3>バージョン情報</h3>
                <p>管理センター Phase1</p>
              </section>
              <section>
                <h3>権限管理</h3>
                <p>スタッフ管理の role 設定を引き続き利用します。</p>
              </section>
              <section>
                <h3>システム設定</h3>
                <p>
                  既存機能を保持したまま、今後の管理者向け設定の入口として利用します。
                </p>
              </section>
            </div>
          ) : null}
        </section>

        <Link className="text-link" to="/cases">
          案件一覧へ
        </Link>
      </section>
    </main>
  );
}
