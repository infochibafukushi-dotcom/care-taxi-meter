import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { StaffManagementPanel } from "../components/admin/StaffManagementPanel";
import { StoreManagementPanel } from "../components/admin/StoreManagementPanel";
import { TimeMeterDiscountSettingsPanel } from "../components/admin/TimeMeterDiscountSettingsPanel";
import { VehicleManagementPanel } from "../components/admin/VehicleManagementPanel";
import { fetchCaseRecords } from "../services/caseRecords";
import { fetchStaffMembers, saveStaffMember } from "../services/staffMembers";
import {
  defaultCompanyId,
  ensureDefaultStore,
  fetchStores,
} from "../services/stores";
import { fetchVehicles, saveVehicle } from "../services/vehicles";
import { fetchClosedWorkSessionsInClockOutRange, fetchWorkingWorkSessionCount } from "../services/workSessions";
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
import type { StaffMember, StaffRole, Store, Vehicle, WorkSession } from "../types/work";
import { useWorkSession } from "../hooks/useWorkSession";
import { ROLE_LABELS, canAccessAdminSection } from "../types/permissions";
import { calculateSalesSummary, getMonthRangeInJapan } from "../utils/caseRecords";
import { logDiagnostic } from "../utils/diagnostics";
import { tenantScopeFromSession } from "../services/tenancy";
import { loadAuthStaffSession, loadHqViewingSession, restoreHqSessionFromViewingMode } from "../services/authSession";

type AdminSummaryState = {
  errorMessage: string;
  isLoading: boolean;
  caseRecords: StoredCaseRecord[];
  workSessions: WorkSession[];
};

type AdminCenterSection =
  | "company"
  | "fare"
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
    label: "従業員管理",
    description: "従業員の登録・編集・権限管理",
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
    label: "会社情報・帳票設定",
    description: "領収書に反映する会社情報と帳票設定",
  },
  {
    id: "fare",
    label: "料金設定",
    description: "運賃および各種料金設定",
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

const getCurrentJapanMonth = () => {
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
  const monthRange = getMonthRangeInJapan(now);

  return {
    daysInMonth,
    firstDay,
    month,
    monthLabel: monthFormatter.format(firstDay),
    startIso: monthRange.startIso,
    endIso: monthRange.endIso,
    year,
  };
};

const getOptionalNumber = (source: unknown, keys: string[]) => {
  if (!source || typeof source !== "object") {
    return 0;
  }

  const values = source as Record<string, unknown>;
  const matchedValue = keys.map((key) => values[key]).find(
    (value) => typeof value === "number" && Number.isFinite(value),
  );

  return typeof matchedValue === "number" ? Math.max(Math.floor(matchedValue), 0) : 0;
};

const getWorkSessionRestSeconds = (workSession: WorkSession) =>
  getOptionalNumber(workSession, ["restSeconds", "breakSeconds", "breakTimeSeconds"]);

const getWorkSessionBoundSeconds = (workSession: WorkSession) => {
  if (workSession.workSeconds > 0) {
    return Math.max(Math.floor(workSession.workSeconds), 0);
  }

  if (!workSession.clockOutAt) {
    return 0;
  }

  const clockInTime = new Date(workSession.clockInAt).getTime();
  const clockOutTime = new Date(workSession.clockOutAt).getTime();

  if (Number.isNaN(clockInTime) || Number.isNaN(clockOutTime)) {
    return 0;
  }

  return Math.max(Math.floor((clockOutTime - clockInTime) / 1000), 0);
};

const getPersonalOperationDays = ({
  caseRecords,
  staffId,
  workSessions,
}: {
  caseRecords: StoredCaseRecord[];
  staffId: string;
  workSessions: WorkSession[];
}) => {
  const { daysInMonth, month, monthLabel, year } = getCurrentJapanMonth();
  const recordsByDay = new Map<string, StoredCaseRecord[]>();
  const sessionsByDay = new Map<string, WorkSession[]>();

  caseRecords.forEach((caseRecord) => {
    if (staffId && caseRecord.staffId !== staffId && caseRecord.driverId !== staffId) {
      return;
    }

    const closedDate = new Date(caseRecord.closedAt);
    if (Number.isNaN(closedDate.getTime())) {
      return;
    }

    const dateKey = dateKeyFormatter.format(closedDate);
    const currentRecords = recordsByDay.get(dateKey) ?? [];
    currentRecords.push(caseRecord);
    recordsByDay.set(dateKey, currentRecords);
  });

  workSessions.forEach((workSession) => {
    if (staffId && workSession.staffId !== staffId) {
      return;
    }

    if (workSession.status !== "closed" || !workSession.clockOutAt) {
      return;
    }

    const clockOutDate = new Date(workSession.clockOutAt);
    if (Number.isNaN(clockOutDate.getTime())) {
      return;
    }

    const dateKey = dateKeyFormatter.format(clockOutDate);
    const currentSessions = sessionsByDay.get(dateKey) ?? [];
    currentSessions.push(workSession);
    sessionsByDay.set(dateKey, currentSessions);
  });

  const days: PersonalOperationDay[] = Array.from(
    { length: daysInMonth },
    (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, index + 1, 0, 0, 0));
      const dateKey = dateKeyFormatter.format(date);
      const dayRecords = recordsByDay.get(dateKey) ?? [];
      const daySessions = sessionsByDay.get(dateKey) ?? [];
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
      const boundSeconds = daySessions.reduce(
        (total, workSession) => total + getWorkSessionBoundSeconds(workSession),
        0,
      );
      const restSeconds = daySessions.reduce(
        (total, workSession) => total + getWorkSessionRestSeconds(workSession),
        0,
      );
      const workSeconds = Math.max(boundSeconds - restSeconds, 0);
      const firstClockIn = daySessions
        .map((workSession) => workSession.clockInAt)
        .filter(Boolean)
        .sort()[0];
      const lastClockOut = daySessions
        .map((workSession) => workSession.clockOutAt ?? "")
        .filter(Boolean)
        .sort()
        .at(-1);
      const averageYen = totalCases > 0 ? Math.round(salesYen / totalCases) : 0;
      const timeSalesYen =
        workSeconds > 0
          ? Math.round(salesYen / (workSeconds / secondsPerHour))
          : 0;

      return {
        averageYen,
        boundSeconds,
        clockIn: firstClockIn
          ? new Intl.DateTimeFormat("ja-JP", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(firstClockIn))
          : "－",
        clockOut: lastClockOut
          ? new Intl.DateTimeFormat("ja-JP", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(lastClockOut))
          : "－",
        date,
        dateKey,
        dayLabel: dayFormatter.format(date),
        drivingSeconds,
        inspectionDone: daySessions.length > 0,
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
  const navigate = useNavigate();
  const authSession = useMemo(() => loadAuthStaffSession(), []);
  const hqViewingSession = useMemo(() => loadHqViewingSession(), []);
  const sessionSource = workSession.currentSession ?? authSession;
  const currentScope = tenantScopeFromSession(sessionSource);
  const currentFranchiseeId = currentScope.franchiseeId;
  const currentStoreId = currentScope.storeId;
  const currentStoreName = sessionSource?.storeName || "本店";
  const currentStaffId = workSession.currentSession?.staffId ?? authSession?.id ?? "";
  const currentStaffName = workSession.currentSession?.staffName ?? authSession?.name ?? "";
  const currentRole: StaffRole | "" = workSession.currentSession?.staffRole ?? authSession?.role ?? (location.pathname.startsWith("/hq") || location.pathname.startsWith("/superadmin") ? "hq_admin" : location.pathname.startsWith("/owner") ? "owner" : location.pathname.startsWith("/manager") ? "manager" : location.pathname.startsWith("/driver") ? "driver" : "");
  const [summaryState, setSummaryState] = useState<AdminSummaryState>({
    errorMessage: "",
    isLoading: true,
    caseRecords: [],
    workSessions: [],
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
  const [selectedPersonalStaffId, setSelectedPersonalStaffId] = useState(currentStaffId);

  useEffect(() => {
    const mountedPathname = window.location.pathname;
    logDiagnostic("AdminPage mount", { pathname: mountedPathname });
    return () => logDiagnostic("AdminPage unmount", { pathname: mountedPathname });
  }, []);
  const [masterMessage, setMasterMessage] = useState(
    "店舗・従業員・車両情報を読み込み中です。",
  );
  const availableAdminCenterCards = adminCenterCards.filter((card) =>
    canAccessAdminSection(currentRole, card.id),
  );
  const ownerDefaultStore: Store = stores.find((store) => store.id === currentStoreId) ?? {
    id: currentStoreId,
    companyId: currentFranchiseeId,
    franchiseeId: currentFranchiseeId,
    name: currentStoreName,
    storeName: currentStoreName,
    status: "active",
    enabled: true,
    isActive: true,
    sortOrder: 1,
  };
  const isFranchiseeOwnerAdmin = currentRole === "owner";
  const applyDefaultTenantToStaffMember = (staffMember: StaffMember): StaffMember => ({
    ...staffMember,
    companyId: isFranchiseeOwnerAdmin ? currentFranchiseeId : staffMember.franchiseeId || staffMember.companyId,
    franchiseeId: isFranchiseeOwnerAdmin ? currentFranchiseeId : staffMember.franchiseeId || staffMember.companyId,
    storeId: isFranchiseeOwnerAdmin ? ownerDefaultStore.id : staffMember.storeId,
    storeName: isFranchiseeOwnerAdmin ? ownerDefaultStore.name : staffMember.storeName,
    loginId: staffMember.loginId || staffMember.userId || staffMember.name,
    userId: staffMember.userId || staffMember.loginId || staffMember.name,
  });
  const applyDefaultTenantToVehicle = (vehicle: Vehicle): Vehicle => ({
    ...vehicle,
    companyId: isFranchiseeOwnerAdmin ? currentFranchiseeId : vehicle.franchiseeId || vehicle.companyId,
    franchiseeId: isFranchiseeOwnerAdmin ? currentFranchiseeId : vehicle.franchiseeId || vehicle.companyId,
    storeId: isFranchiseeOwnerAdmin ? ownerDefaultStore.id : vehicle.storeId,
    storeName: isFranchiseeOwnerAdmin ? ownerDefaultStore.name : vehicle.storeName,
  });

  useEffect(() => {
    let isMounted = true;

    fetchCaseRecords({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: currentRole, staffId: currentStaffId })
      .then((caseRecords) => {
        if (!isMounted) {
          return;
        }

        setSummaryState((currentState) => ({
          ...currentState,
          errorMessage: "",
          isLoading: false,
          caseRecords,
        }));
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setSummaryState((currentState) => ({
          ...currentState,
          errorMessage:
            error instanceof Error
              ? error.message
              : "管理画面の集計取得に失敗しました。",
          isLoading: false,
          caseRecords: [],
        }));
      });

    return () => {
      isMounted = false;
    };
  }, [currentRole, currentFranchiseeId, currentStoreId, currentStaffId]);

  useEffect(() => {
    const staffId = currentRole === "driver" ? currentStaffId : selectedPersonalStaffId;

    if (currentRole === "driver" && !staffId) {
      let isActive = true;
      void Promise.resolve().then(() => {
        if (isActive) {
          setSummaryState((currentState) => ({ ...currentState, workSessions: [] }));
        }
      });

      return () => {
        isActive = false;
      };
    }

    const { endIso, startIso } = getCurrentJapanMonth();
    let isMounted = true;

    fetchClosedWorkSessionsInClockOutRange({
      endIso,
      scope: {
        franchiseeId: currentFranchiseeId,
        role: currentRole,
        staffId: currentRole === "driver" ? staffId : undefined,
        storeId: currentStoreId,
      },
      startIso,
    })
      .then((workSessions) => {
        if (!isMounted) {
          return;
        }

        setSummaryState((currentState) => ({ ...currentState, workSessions }));
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setSummaryState((currentState) => ({
          ...currentState,
          errorMessage:
            error instanceof Error
              ? error.message
              : "勤務実績の取得に失敗しました。",
          workSessions: [],
        }));
      });

    return () => {
      isMounted = false;
    };
  }, [currentFranchiseeId, currentRole, currentStoreId, currentStaffId, selectedPersonalStaffId]);

  useEffect(() => {
    let isMounted = true;

    fetchMeterSettings({ franchiseeId: currentFranchiseeId, storeId: currentStoreId })
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
  }, [currentFranchiseeId, currentStoreId]);

  useEffect(() => {
    let isMounted = true;

    Promise.all([fetchStores(currentRole === "hq_admin" ? undefined : currentFranchiseeId), fetchStaffMembers({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: currentRole }), fetchVehicles({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: currentRole })])
      .then(([loadedStores, loadedStaffMembers, loadedVehicles]) => {
        if (!isMounted) {
          return;
        }

        setStores(loadedStores);
        setStaffMembers(loadedStaffMembers);
        setVehicles(loadedVehicles);
        setMasterMessage("店舗・従業員・車両情報を読み込みました。");
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setMasterMessage(
          error instanceof Error
            ? `店舗・従業員・車両情報を読み込めませんでした。${error.message}`
            : "店舗・従業員・車両情報を読み込めませんでした。",
        );
      });

    return () => {
      isMounted = false;
    };
  }, [currentRole, currentFranchiseeId, currentStoreId]);


  useEffect(() => {
    let isActive = true;

    void Promise.resolve().then(() => {
      if (!isActive) {
        return;
      }

      if (currentRole === "driver") {
        setSelectedPersonalStaffId(currentStaffId);
        return;
      }

      if (selectedPersonalStaffId && staffMembers.some((staffMember) => staffMember.id === selectedPersonalStaffId)) {
        return;
      }

      const firstStoreStaff = staffMembers
        .filter((staffMember) => staffMember.enabled && staffMember.storeId === currentStoreId)
        .sort((firstStaff, secondStaff) => firstStaff.sortOrder - secondStaff.sortOrder)[0];
      setSelectedPersonalStaffId(firstStoreStaff?.id || currentStaffId);
    });

    return () => {
      isActive = false;
    };
  }, [currentRole, currentStaffId, currentStoreId, selectedPersonalStaffId, staffMembers]);

  useEffect(() => {
    let isMounted = true;

    fetchWorkingWorkSessionCount({ franchiseeId: currentFranchiseeId, storeId: currentStoreId, role: currentRole })
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
  }, [currentFranchiseeId, currentRole, currentStoreId]);

  const salesSummary = calculateSalesSummary(summaryState.caseRecords);
  const activeVehicleCount = vehicles.filter(
    (vehicle) => vehicle.enabled && vehicle.status === "稼働中",
  ).length;
  const personalOperationStaffOptions = staffMembers
    .filter((staffMember) => staffMember.enabled && staffMember.storeId === currentStoreId)
    .sort((firstStaff, secondStaff) => firstStaff.sortOrder - secondStaff.sortOrder);
  const personalOperationSelectedStaffId = currentRole === "driver" ? currentStaffId : selectedPersonalStaffId || personalOperationStaffOptions[0]?.id || currentStaffId;
  const personalOperationSelectedStaff = personalOperationStaffOptions.find((staffMember) => staffMember.id === personalOperationSelectedStaffId)
    ?? staffMembers.find((staffMember) => staffMember.id === personalOperationSelectedStaffId)
    ?? null;
  const personalOperationMonthly = getPersonalOperationDays({
    caseRecords: summaryState.caseRecords,
    staffId: personalOperationSelectedStaffId,
    workSessions: summaryState.workSessions,
  });
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
    personalOperationTotals.workSeconds > 0
      ? Math.round(
          personalOperationTotals.salesYen /
            (personalOperationTotals.workSeconds / secondsPerHour),
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

  const updateDiscount = (updates: Partial<MeterSettings["discount"]>) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      discount: { ...currentSettings.discount, ...updates },
    }));
  };

  const updateObdMeterTimeFare = (key: keyof MeterTimeFareSettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      meterSettings: {
        ...currentSettings.meterSettings,
        obd: {
          ...currentSettings.meterSettings.obd,
          meterTimeFare: {
            ...currentSettings.meterSettings.obd.meterTimeFare,
            [key]: key === "unitSeconds" ? Math.max(Math.floor(Number(value) || 1), 1) : toPositiveNumber(value),
          },
        },
      },
    }));
  };

  const updateObdBasicFare = (key: keyof BasicFareSettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      meterSettings: {
        ...currentSettings.meterSettings,
        obd: {
          ...currentSettings.meterSettings.obd,
          basicFare: {
            ...currentSettings.meterSettings.obd.basicFare,
            [key]: toPositiveNumber(value, key.includes("Distance") ? 0.001 : 0),
          },
        },
      },
    }));
  };

  const copyGpsFareToObd = () => {
    if (!window.confirm("GPSメーター料金設定をOBD料金設定へコピーしますか？")) return;
    setSettings((currentSettings) => ({
      ...currentSettings,
      meterSettings: {
        ...currentSettings.meterSettings,
        obd: { ...currentSettings.meterSettings.gps, basicFare: currentSettings.basicFare, meterTimeFare: currentSettings.meterTimeFare, waitingFare: currentSettings.waitingFare, escortFare: currentSettings.escortFare, assistItems: currentSettings.assistItems, dispatchMenuItems: currentSettings.dispatchMenuItems, specialVehicleMenuItems: currentSettings.specialVehicleMenuItems, discount: currentSettings.discount },
      },
    }));
    setSettingsMessage("GPS料金をOBD料金へコピーしました");
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
    const primaryStore = isFranchiseeOwnerAdmin ? ownerDefaultStore : stores[0];
    return {
      id: `staff-${Date.now()}-${crypto.randomUUID()}`,
      companyId: primaryStore?.franchiseeId ?? primaryStore?.companyId ?? defaultCompanyId,
      franchiseeId: primaryStore?.franchiseeId ?? primaryStore?.companyId ?? defaultCompanyId,
      storeId: primaryStore?.id ?? "",
      storeName: primaryStore?.name ?? "",
      userId: "新しい従業員",
      loginId: "新しい従業員",
      password: "",
      name: "新しい従業員",
      role: "driver",
      canDrive: true,
      isActive: true,
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
    const primaryStore = isFranchiseeOwnerAdmin ? ownerDefaultStore : stores[0];
    return {
      id: `vehicle-${Date.now()}-${crypto.randomUUID()}`,
      companyId: primaryStore?.franchiseeId ?? primaryStore?.companyId ?? defaultCompanyId,
      franchiseeId: primaryStore?.franchiseeId ?? primaryStore?.companyId ?? defaultCompanyId,
      storeId: primaryStore?.id ?? "",
      storeName: primaryStore?.name ?? "",
      name: "新しい車両",
      vehicleName: "新しい車両",
      number: "",
      plateNumber: "",
      status: "稼働中",
      fuelType: "",
      vehicleType: "",
      wheelchairCapacity: 0,
      stretcherSupported: false,
      inspectionExpiresAt: "",
      insuranceExpiresAt: "",
      memo: "",
      enabled: true,
      isActive: true,
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
        staffMember.id === id ? applyDefaultTenantToStaffMember({ ...staffMember, ...updates }) : staffMember,
      ),
    );
  };

  const updateVehicle = (id: string, updates: Partial<Vehicle>) => {
    setVehicles((currentVehicles) =>
      currentVehicles.map((vehicle) =>
        vehicle.id === id ? applyDefaultTenantToVehicle({ ...vehicle, ...updates }) : vehicle,
      ),
    );
  };

  const handleStaffSave = async () => {
    const hasEmptyName = staffMembers.some(
      (staffMember) => !staffMember.name.trim(),
    );

    if (hasEmptyName) {
      setMasterMessage("従業員名は空欄にできません。");
      return;
    }

    const invalidSuperAdminAssignment = currentRole !== "hq_admin" && staffMembers.some(
      (staffMember) => staffMember.role === "hq_admin" && staffMember.userId !== "admin",
    );

    if (invalidSuperAdminAssignment) {
      setMasterMessage("本部管理者権限はFC本部権限でログインした場合のみ付与できます。");
      return;
    }

    const hasDriverMissingTenant = staffMembers.some(
      (staffMember) =>
        staffMember.role === "driver" &&
        (!staffMember.companyId ||
          !staffMember.franchiseeId ||
          !staffMember.storeId ||
          !staffMember.storeName),
    );

    if (hasDriverMissingTenant) {
      setMasterMessage("店舗情報が取得できません。再読み込みしてください。");
      return;
    }

    try {
      const auditActor = currentStaffId
        ? {
            franchiseeId: currentFranchiseeId,
            role: currentRole || "driver",
            storeId: currentStoreId,
            userId: currentStaffId,
            userName: currentStaffName,
          }
        : null;
      await Promise.all(staffMembers.map((staffMember) => saveStaffMember(applyDefaultTenantToStaffMember(staffMember), auditActor)));
      setMasterMessage("従業員情報を保存しました。");
    } catch (error) {
      setMasterMessage(
        error instanceof Error
          ? `従業員情報を保存できませんでした。${error.message}`
          : "従業員情報を保存できませんでした。",
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
      await Promise.all(vehicles.map((vehicle) => saveVehicle(applyDefaultTenantToVehicle(vehicle))));
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
    const hasEmptyDiscountName = !settings.discount.name.trim();
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
      hasEmptyDiscountName ||
      hasEmptyAssistItemName ||
      hasEmptyDispatchMenuName ||
      hasEmptySpecialVehicleMenuName
    ) {
      setSettingsSaveState("error");
      setSettingsMessage(
        "割引名称・介助項目・予約迎車・特殊車両メニューの名称は空欄にできません。",
      );
      return;
    }

    setSettingsSaveState("saving");
    setSettingsMessage("Firestoreへ設定を保存中です。");

    try {
      const savedSettings = await saveMeterSettings(settings, currentScope);
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
              <h1 id="admin-title">{currentRole === "hq_admin" ? `FC本部画面は /hq を利用してください` : `管理センター：${currentStoreName}`}</h1>
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
    <main className={`page admin-page${hqViewingSession ? " admin-page--hq-view" : ""}`} aria-labelledby="admin-title">
      {hqViewingSession ? (
        <div className="hq-viewing-banner" role="status">
          <strong>FC本部閲覧モード</strong>
          <span>加盟店：{hqViewingSession.companyName}</span>
          <span>※ 閲覧専用です</span>
          <button className="secondary-action" type="button" onClick={() => navigate(restoreHqSessionFromViewingMode())}>FC本部へ戻る</button>
        </div>
      ) : null}
      <section className="content-card admin-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Admin Center</p>
            <h1 id="admin-title">{currentRole === "hq_admin" ? `FC本部画面は /hq を利用してください` : `管理センター：${currentStoreName}`}</h1>
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
            {["company", "fare"].includes(activeAdminSection) ? (
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

          {["company", "fare"].includes(activeAdminSection) ? (
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
              canAssignHqAdmin={currentRole === "hq_admin"}
              canSelectStore={!isFranchiseeOwnerAdmin}
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
              canSelectStore={!isFranchiseeOwnerAdmin}
            />
          ) : null}

          {activeAdminSection === "fare" ? (
            <div className="fare-accordion-stack">
              <details className="fare-settings-accordion" open>
                <summary>GPSメーター料金設定</summary>
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
                <legend>割引設定</legend>
                <p className="admin-settings-note">
                  精算画面・領収書・利用明細に表示する割引名称と計算方式を設定します。
                </p>
                <label>
                  割引名称
                  <input
                    value={settings.discount.name}
                    onChange={(event) => updateDiscount({ name: event.target.value })}
                  />
                </label>
                <label>
                  割引方式
                  <select
                    value={settings.discount.method}
                    onChange={(event) => updateDiscount({ method: event.target.value === "fixed" ? "fixed" : "percentage" })}
                  >
                    <option value="percentage">割合割引（％）</option>
                    <option value="fixed">固定額割引（円）</option>
                  </select>
                </label>
                <label>
                  割引値（{settings.discount.method === "percentage" ? "％" : "円"}）
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={settings.discount.value}
                    onChange={(event) => updateDiscount({ value: toPositiveNumber(event.target.value) })}
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
              </details>

              <details className="fare-settings-accordion">
                <summary>時間制メーター料金設定</summary>
                <div className="admin-settings-grid">
                  <TimeMeterDiscountSettingsPanel
                    timeSettings={settings.time}
                    onChange={(time) =>
                      setSettings((currentSettings) => ({
                        ...currentSettings,
                        time,
                        meterSettings: {
                          ...currentSettings.meterSettings,
                          time: {
                            ...currentSettings.meterSettings.time,
                            baseMinutes: time.legal.baseMinutes,
                            baseFareYen: time.legal.baseFareYen,
                            additionalFare: {
                              ...currentSettings.meterSettings.time.additionalFare,
                              unitSeconds: time.legal.additionalMinutes * 60,
                              unitFareYen: time.legal.additionalFareYen,
                            },
                          },
                        },
                      }))
                    }
                  />
                </div>
              </details>

              <details className="fare-settings-accordion">
                <summary>OBDメーター料金設定</summary>
                <div className="admin-settings-grid">
                  <fieldset className="admin-settings-wide">
                    <legend>GPS料金コピー</legend>
                    <button type="button" onClick={copyGpsFareToObd}>
                      GPS料金をコピー
                    </button>
                  </fieldset>
                  <fieldset>
                    <legend>OBD基本運賃設定</legend>
                    <label>
                      初乗距離(km)
                      <input
                        min="0"
                        step="0.001"
                        type="number"
                        value={settings.meterSettings.obd.basicFare.initialDistanceKm}
                        onChange={(event) =>
                          updateObdBasicFare('initialDistanceKm', event.target.value)
                        }
                      />
                    </label>
                    <label>
                      初乗運賃(円)
                      <input
                        min="0"
                        type="number"
                        value={settings.meterSettings.obd.basicFare.initialFareYen}
                        onChange={(event) =>
                          updateObdBasicFare('initialFareYen', event.target.value)
                        }
                      />
                    </label>
                  </fieldset>
                  <fieldset>
                    <legend>OBD距離加算設定</legend>
                    <label>
                      距離加算距離（m）
                      <input
                        min="1"
                        step="1"
                        type="number"
                        value={Math.round(
                          settings.meterSettings.obd.basicFare.additionalDistanceKm * 1000,
                        )}
                        onChange={(event) =>
                          updateObdBasicFare(
                            'additionalDistanceKm',
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
                        value={settings.meterSettings.obd.basicFare.additionalFareYen}
                        onChange={(event) =>
                          updateObdBasicFare('additionalFareYen', event.target.value)
                        }
                      />
                    </label>
                  </fieldset>
                  <fieldset>
                    <legend>OBD時間加算設定</legend>
                    <label>
                      低速判定速度（km/h）
                      <input
                        min="0"
                        step="0.1"
                        type="number"
                        value={settings.meterSettings.obd.meterTimeFare.lowSpeedThresholdKmh}
                        onChange={(event) =>
                          updateObdMeterTimeFare('lowSpeedThresholdKmh', event.target.value)
                        }
                      />
                    </label>
                    <label>
                      時間加算秒数（秒）
                      <input
                        min="1"
                        step="1"
                        type="number"
                        value={settings.meterSettings.obd.meterTimeFare.unitSeconds}
                        onChange={(event) =>
                          updateObdMeterTimeFare('unitSeconds', event.target.value)
                        }
                      />
                    </label>
                    <label>
                      時間加算金額（円）
                      <input
                        min="0"
                        type="number"
                        value={settings.meterSettings.obd.meterTimeFare.unitFareYen}
                        onChange={(event) =>
                          updateObdMeterTimeFare('unitFareYen', event.target.value)
                        }
                      />
                    </label>
                  </fieldset>
                </div>
              </details>
            </div>
          ) : null}

          {activeAdminSection === "company" ? (
            <div className="admin-settings-grid">
              <fieldset className="admin-settings-wide">
                <legend>会社情報</legend>
                <label>
                  法人名
                  <input
                    value={settings.company.corporateName}
                    onChange={(event) => {
                      updateCompany("corporateName", event.target.value)
                      updateCompany("companyName", event.target.value)
                    }}
                  />
                </label>
                <label>
                  屋号名
                  <input
                    value={settings.company.tradeName}
                    onChange={(event) => updateCompany("tradeName", event.target.value)}
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
                  郵便番号
                  <input
                    value={settings.company.postalCode}
                    onChange={(event) => updateCompany("postalCode", event.target.value)}
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
                  領収書タイトル
                  <input
                    value={settings.receipt.receiptDefault}
                    onChange={(event) =>
                      updateReceipt("receiptDefault", event.target.value)
                    }
                  />
                </label>
                <label>
                  利用明細書タイトル
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
                  ここで保存した会社情報・帳票設定は、領収書・利用明細書・レシートに自動反映されます。登録番号が未設定の場合は帳票に表示しません。
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
                </div>
                <div className="personal-operation-header-actions">
                  {currentRole === "owner" || currentRole === "manager" ? (
                    <label>
                      従業員
                      <select
                        value={personalOperationSelectedStaffId}
                        onChange={(event) => setSelectedPersonalStaffId(event.target.value)}
                      >
                        {personalOperationStaffOptions.map((staffMember) => (
                          <option key={staffMember.id} value={staffMember.id}>
                            {staffMember.name}（{ROLE_LABELS[staffMember.role]}）
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span>{personalOperationSelectedStaff?.name || currentStaffName}</span>
                  )}
                  <strong>{personalOperationMonthly.monthLabel}</strong>
                </div>
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
                <p>加盟店運行管理 Phase1</p>
              </section>
              <section>
                <h3>権限管理</h3>
                <p>従業員管理の role 設定を利用します。FC本部のロール定義・権限設定は /hq のシステム設定で管理します。</p>
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
