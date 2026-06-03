import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import type { StaffMember, Store, Vehicle } from "../types/work";
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
    id: "system",
    label: "システム設定",
    description: "システム管理者向け設定",
  },
];

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

const createSpecialVehicleMenuItem = (sortOrder: number): SpecialVehicleMenuItem => ({
  amount: 1000,
  enabled: true,
  id: `special-vehicle-${Date.now()}-${crypto.randomUUID()}`,
  name: "1BOXリフト車両",
  sortOrder,
});

export function AdminPage() {
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
        [key]: key === "unitSeconds"
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
    key: keyof Pick<DispatchMenuItem, "amount" | "enabled" | "name" | "sortOrder">,
    value: string | boolean,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      dispatchMenuItems: currentSettings.dispatchMenuItems.map((dispatchItem) =>
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
    key: keyof Pick<SpecialVehicleMenuItem, "amount" | "enabled" | "name" | "sortOrder">,
    value: string | boolean,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      specialVehicleMenuItems: currentSettings.specialVehicleMenuItems.map((specialItem) =>
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
        createSpecialVehicleMenuItem(currentSettings.specialVehicleMenuItems.length + 1),
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
    const hasEmptySpecialVehicleMenuName = settings.specialVehicleMenuItems.some(
      (specialItem) => !specialItem.name.trim(),
    );

    if (hasEmptyAssistItemName || hasEmptyDispatchMenuName || hasEmptySpecialVehicleMenuName) {
      setSettingsSaveState("error");
      setSettingsMessage("介助項目・予約迎車・特殊車両メニューの名称は空欄にできません。");
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
          Firestoreの保存済み案件から売上状況を集計し、
          管理メニューから各業務設定を選択して編集・保存します。
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
            {adminCenterCards.map((card) => (
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
                  adminCenterCards.find(
                    (card) => card.id === activeAdminSection,
                  )?.label
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
                    value={Math.round(settings.basicFare.additionalDistanceKm * 1000)}
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
                  GPS速度が低速判定速度以下の場合のみ進行します。速度未取得時は直近GPSログの移動距離÷経過時間で判定します。
                </p>
                <label>
                  低速判定速度（km/h）
                  <input
                    min="0"
                    step="0.1"
                    type="number"
                    value={settings.meterTimeFare.lowSpeedThresholdKmh}
                    onChange={(event) =>
                      updateMeterTimeFare("lowSpeedThresholdKmh", event.target.value)
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
                            onClick={() => removeDispatchMenuItem(dispatchItem.id)}
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
                            onClick={() => removeSpecialVehicleMenuItem(specialItem.id)}
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
