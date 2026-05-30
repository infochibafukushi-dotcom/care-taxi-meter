import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCaseRecordsInClosedAtRange } from '../services/caseRecords'
import type { StoredCaseRecord } from '../services/caseRecords'
import { formatFareYen } from '../services/fare'
import type { BasicFareSettings, CareOptionMasterItem } from '../services/fare'
import {
  defaultMeterSettings,
  fetchMeterSettings,
  fixedTimeFareUnitSeconds,
  saveMeterSettings,
} from '../services/meterSettings'
import type {
  CompanySettings,
  ExpensePreset,
  MeterSettings,
  ReceiptSettings,
} from '../services/meterSettings'
import {
  calculateCaseSummary,
  getMonthRangeInJapan,
  getTodayRangeInJapan,
} from '../utils/caseRecords'

type AdminSummaryState = {
  errorMessage: string
  isLoading: boolean
  monthlyCaseRecords: StoredCaseRecord[]
}

type SettingsTab = 'company' | 'fare' | 'receipt'

type SettingsSaveState = 'error' | 'idle' | 'saved' | 'saving'

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'fare', label: '料金設定' },
  { id: 'company', label: '会社情報' },
  { id: 'receipt', label: '領収書設定' },
]

const toPositiveNumber = (value: string, minimum = 0) =>
  Math.max(Number(value) || minimum, minimum)

const createExpensePreset = (): ExpensePreset => ({
  defaultAmountYen: 0,
  id: `expense-${Date.now()}-${crypto.randomUUID()}`,
  name: '',
})

export function AdminPage() {
  const [summaryState, setSummaryState] = useState<AdminSummaryState>({
    errorMessage: '',
    isLoading: true,
    monthlyCaseRecords: [],
  })
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('fare')
  const [settings, setSettings] = useState<MeterSettings>(defaultMeterSettings)
  const [settingsSaveState, setSettingsSaveState] =
    useState<SettingsSaveState>('idle')
  const [settingsMessage, setSettingsMessage] = useState(
    'Firestoreから設定を読み込み中です。',
  )

  useEffect(() => {
    let isMounted = true
    const monthRange = getMonthRangeInJapan()

    fetchCaseRecordsInClosedAtRange(monthRange)
      .then((monthlyCaseRecords) => {
        if (!isMounted) {
          return
        }

        setSummaryState({
          errorMessage: '',
          isLoading: false,
          monthlyCaseRecords,
        })
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setSummaryState({
          errorMessage:
            error instanceof Error
              ? error.message
              : '管理画面の集計取得に失敗しました。',
          isLoading: false,
          monthlyCaseRecords: [],
        })
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    fetchMeterSettings()
      .then((loadedSettings) => {
        if (!isMounted) {
          return
        }

        setSettings(loadedSettings)
        setSettingsMessage('Firestore設定を読み込みました。')
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setSettingsMessage(
          error instanceof Error
            ? `Firestore設定を読み込めませんでした。${error.message}`
            : 'Firestore設定を読み込めませんでした。',
        )
        setSettingsSaveState('error')
      })

    return () => {
      isMounted = false
    }
  }, [])

  const todayRange = getTodayRangeInJapan()
  const todaySummary = calculateCaseSummary(
    summaryState.monthlyCaseRecords.filter(
      (caseRecord) =>
        caseRecord.closedAt >= todayRange.startIso &&
        caseRecord.closedAt < todayRange.endIso,
    ),
  )
  const monthSummary = calculateCaseSummary(summaryState.monthlyCaseRecords)

  const updateBasicFare = (key: keyof BasicFareSettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      basicFare: {
        ...currentSettings.basicFare,
        [key]: toPositiveNumber(
          value,
          key.includes('Distance') ? 0.001 : 0,
        ),
      },
    }))
  }

  const updateWaitingFare = (value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      waitingFare: {
        unitFareYen: toPositiveNumber(value),
        unitSeconds: fixedTimeFareUnitSeconds,
      },
    }))
  }

  const updateEscortFare = (value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      escortFare: {
        unitFareYen: toPositiveNumber(value),
        unitSeconds: fixedTimeFareUnitSeconds,
      },
    }))
  }

  const updateCareOption = (
    id: string,
    key: keyof Pick<CareOptionMasterItem, 'defaultAmountYen'>,
    value: string,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      careOptions: currentSettings.careOptions.map((careOption) =>
        careOption.id === id
          ? { ...careOption, [key]: toPositiveNumber(value) }
          : careOption,
      ),
    }))
  }

  const updateExpensePreset = (
    id: string,
    key: keyof Pick<ExpensePreset, 'defaultAmountYen' | 'name'>,
    value: string,
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      expensePresets: currentSettings.expensePresets.map((expensePreset) =>
        expensePreset.id === id
          ? {
              ...expensePreset,
              [key]: key === 'name' ? value : toPositiveNumber(value),
            }
          : expensePreset,
      ),
    }))
  }

  const addExpensePreset = () => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      expensePresets: [
        ...currentSettings.expensePresets,
        createExpensePreset(),
      ],
    }))
  }

  const removeExpensePreset = (id: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      expensePresets: currentSettings.expensePresets.filter(
        (expensePreset) => expensePreset.id !== id,
      ),
    }))
  }

  const updateCompany = (key: keyof CompanySettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      company: { ...currentSettings.company, [key]: value },
    }))
  }

  const updateReceipt = (key: keyof ReceiptSettings, value: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      receipt: { ...currentSettings.receipt, [key]: value },
    }))
  }

  const handleSettingsSave = async () => {
    setSettingsSaveState('saving')
    setSettingsMessage('Firestoreへ設定を保存中です。')

    try {
      const savedSettings = await saveMeterSettings(settings)
      setSettings(savedSettings)
      setSettingsSaveState('saved')
      setSettingsMessage('Firestoreへ設定を保存しました。')
    } catch (error) {
      setSettingsSaveState('error')
      setSettingsMessage(
        error instanceof Error
          ? `設定保存に失敗しました。${error.message}`
          : '設定保存に失敗しました。',
      )
    }
  }

  return (
    <main className="page admin-page" aria-labelledby="admin-title">
      <section className="content-card admin-card">
        <div className="case-list-header">
          <div>
            <p className="eyebrow">Admin</p>
            <h1 id="admin-title">管理画面</h1>
          </div>
          <Link className="text-link" to="/">
            ホームへ戻る
          </Link>
        </div>

        <p className="lead admin-lead">
          Firestoreの保存済み案件から本日・今月の売上と件数を集計し、
          料金・会社・領収書設定を保存します。
        </p>

        {summaryState.isLoading ? (
          <p className="empty-note">Firestoreから管理集計を取得中です。</p>
        ) : null}

        {summaryState.errorMessage ? (
          <p className="case-error" role="alert">
            {summaryState.errorMessage}
          </p>
        ) : null}

        <div className="admin-summary-grid" aria-label="管理集計">
          <div>
            <span>本日売上</span>
            <strong>{formatFareYen(todaySummary.salesYen)}円</strong>
          </div>
          <div>
            <span>本日件数</span>
            <strong>{todaySummary.count}件</strong>
          </div>
          <div>
            <span>今月売上</span>
            <strong>{formatFareYen(monthSummary.salesYen)}円</strong>
          </div>
          <div>
            <span>今月件数</span>
            <strong>{monthSummary.count}件</strong>
          </div>
        </div>

        <section className="admin-settings-card" aria-labelledby="settings-heading">
          <div className="admin-settings-header">
            <div>
              <p className="eyebrow">Settings</p>
              <h2 id="settings-heading">設定</h2>
            </div>
            <button
              className="admin-save-button"
              type="button"
              disabled={settingsSaveState === 'saving'}
              onClick={() => {
                void handleSettingsSave()
              }}
            >
              Firestoreへ保存
            </button>
          </div>

          <p className={`save-note save-note--${settingsSaveState}`}>
            {settingsMessage}
          </p>

          <div className="settings-tabs" role="tablist" aria-label="設定タブ">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={activeSettingsTab === tab.id}
                className={activeSettingsTab === tab.id ? 'is-active' : undefined}
                onClick={() => setActiveSettingsTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeSettingsTab === 'fare' ? (
            <div className="admin-settings-grid">
              <fieldset>
                <legend>料金設定</legend>
                <label>
                  初乗距離(km)
                  <input
                    min="0"
                    step="0.001"
                    type="number"
                    value={settings.basicFare.initialDistanceKm}
                    onChange={(event) =>
                      updateBasicFare('initialDistanceKm', event.target.value)
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
                      updateBasicFare('initialFareYen', event.target.value)
                    }
                  />
                </label>
                <label>
                  加算距離(km)
                  <input
                    min="0"
                    step="0.001"
                    type="number"
                    value={settings.basicFare.additionalDistanceKm}
                    onChange={(event) =>
                      updateBasicFare('additionalDistanceKm', event.target.value)
                    }
                  />
                </label>
                <label>
                  加算運賃(円)
                  <input
                    min="0"
                    type="number"
                    value={settings.basicFare.additionalFareYen}
                    onChange={(event) =>
                      updateBasicFare('additionalFareYen', event.target.value)
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

              <fieldset>
                <legend>介助料金</legend>
                {settings.careOptions.map((careOption) => (
                  <label key={careOption.id}>
                    {careOption.name}
                    <input
                      min="0"
                      type="number"
                      value={careOption.defaultAmountYen}
                      onChange={(event) =>
                        updateCareOption(
                          careOption.id,
                          'defaultAmountYen',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                ))}
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
                              'name',
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
                              'defaultAmountYen',
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

          {activeSettingsTab === 'company' ? (
            <div className="admin-settings-grid">
              <fieldset className="admin-settings-wide">
                <legend>会社情報</legend>
                <label>
                  会社名
                  <input
                    value={settings.company.companyName}
                    onChange={(event) =>
                      updateCompany('companyName', event.target.value)
                    }
                  />
                </label>
                <label>
                  電話番号
                  <input
                    value={settings.company.phoneNumber}
                    onChange={(event) =>
                      updateCompany('phoneNumber', event.target.value)
                    }
                  />
                </label>
                <label>
                  メールアドレス
                  <input
                    type="email"
                    value={settings.company.email}
                    onChange={(event) => updateCompany('email', event.target.value)}
                  />
                </label>
                <label>
                  住所
                  <textarea
                    value={settings.company.address}
                    onChange={(event) => updateCompany('address', event.target.value)}
                  />
                </label>
              </fieldset>
            </div>
          ) : null}

          {activeSettingsTab === 'receipt' ? (
            <div className="admin-settings-grid">
              <fieldset className="admin-settings-wide">
                <legend>領収書設定</legend>
                <label>
                  発行担当者
                  <input
                    value={settings.receipt.issuerName}
                    onChange={(event) =>
                      updateReceipt('issuerName', event.target.value)
                    }
                  />
                </label>
                <label>
                  領収書デフォルト
                  <input
                    value={settings.receipt.receiptDefault}
                    onChange={(event) =>
                      updateReceipt('receiptDefault', event.target.value)
                    }
                  />
                </label>
                <label>
                  利用明細書デフォルト
                  <input
                    value={settings.receipt.statementDefault}
                    onChange={(event) =>
                      updateReceipt('statementDefault', event.target.value)
                    }
                  />
                </label>
                <p className="admin-settings-note">
                  領収書の宛名は空欄でも発行できます。宛名入力欄はこのフェーズでは作成していません。
                </p>
              </fieldset>
            </div>
          ) : null}
        </section>

        <Link className="text-link" to="/cases">
          案件一覧へ
        </Link>
      </section>
    </main>
  )
}
