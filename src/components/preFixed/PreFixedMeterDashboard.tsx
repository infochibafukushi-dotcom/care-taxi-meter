import { useState, type ReactNode } from 'react'
import type { FareBreakdown, FareLineItem } from '../../services/fare'
import { formatFareYen } from '../../services/fare'
import type { PreFixedFareConfirmedRouteView } from '../../types/preFixedFareRouteChange'
import type { PreFixedFareRouteStop } from '../../types/preFixedFareRouteChange'
import '../../styles/preFixedMeterDashboard.css'

export type PreFixedMeterRoutePoint = {
  role: 'S' | 'via' | 'G'
  title: string
  facilityName?: string
  address: string
}

type ModalKind = 'nav' | 'assist' | 'fare' | 'settle-confirm' | null

type PreFixedMeterDashboardProps = {
  totalFareYen: number
  breakdownLines: FareLineItem[]
  waitingActive: boolean
  escortActive: boolean
  waitingClockLabel: string
  escortClockLabel: string
  canToggleWaiting: boolean
  canToggleEscort: boolean
  /** 旧「固定運賃で運行開始」と同じ canStartTrip */
  canStartTrip: boolean
  isTripStarting: boolean
  /** 勤務セッション確認中 */
  isWorkSessionLoading?: boolean
  /** fixedFareRun 成立後 true（待機・付き添いだけでは true にしない） */
  tripStarted: boolean
  /** 清算ボタンを押せるか（旧「運行終了」の !canEndFixedTrip 相当） */
  canSettle: boolean
  /** すでに精算前などで確認をスキップして精算画面へ進む */
  settleSkipsConfirm: boolean
  canNavigate: boolean
  canAddAssist: boolean
  canAddExpense: boolean
  canChangeRoute: boolean
  caseSaving: boolean
  isClosed: boolean
  /** 運行開始失敗など（旧右パネル通知の代替表示） */
  actionNotice?: string
  /** 未出勤時に出勤画面へ戻る導線（TOPへ戻るFABは出さない） */
  showAttendanceReturnLink?: boolean
  onAttendanceReturn?: () => void
  onToggleWaiting: () => void
  onToggleEscort: () => void
  onStartTrip: () => void
  onSettle: () => void
  onViewRoute: () => void
  onNavigate: () => void
  onAssistEdit: () => void
  onEquipmentEdit: () => void
  onBasicFeeEdit: () => void
  onExpenseEdit: () => void
  onChangeRoute: () => void
}

/** 料金確認カード用：0円・未選択を除外 */
export const filterPositiveFareLines = (lines: FareLineItem[]): FareLineItem[] =>
  lines.filter((line) => Number.isFinite(line.amountYen) && Math.round(line.amountYen) !== 0)

/**
 * 主ボタンを「清算」表示にするか。
 * 待機／付き添いだけでは false。fixedFareRun 成功後、または精算前導線のみ true。
 */
export const shouldShowPreFixedSettleButton = ({
  hasFixedFareRun,
  canOpenFixedSettlement,
  isPassengerChangePreSettlement,
}: {
  hasFixedFareRun: boolean
  canOpenFixedSettlement: boolean
  isPassengerChangePreSettlement: boolean
}) =>
  Boolean(hasFixedFareRun) ||
  canOpenFixedSettlement ||
  isPassengerChangePreSettlement

/** @deprecated 互換 alias */
export const shouldShowPreFixedPayButton = shouldShowPreFixedSettleButton

export const buildPreFixedMeterRoutePoints = ({
  confirmedRouteView,
  pickupAddress,
  dropoffAddress,
  viaAddresses = [],
}: {
  confirmedRouteView: PreFixedFareConfirmedRouteView | null
  pickupAddress: string
  dropoffAddress: string
  viaAddresses?: string[]
}): PreFixedMeterRoutePoint[] => {
  if (confirmedRouteView?.stops?.length) {
    return confirmedRouteView.stops.map((stop: PreFixedFareRouteStop, index, all) => {
      const isFirst = index === 0
      const isLast = index === all.length - 1
      const role: PreFixedMeterRoutePoint['role'] = isFirst ? 'S' : isLast ? 'G' : 'via'
      const facilityName =
        stop.label.trim() && stop.label.trim() !== stop.address.trim()
          ? stop.label.trim()
          : undefined
      const address = stop.address.trim() || facilityName || '—'
      return {
        role,
        title:
          role === 'S' ? 'S 出発地' : role === 'G' ? 'G 最終目的地' : `経由地${index}`,
        facilityName,
        address,
      }
    })
  }

  const points: PreFixedMeterRoutePoint[] = [
    {
      role: 'S',
      title: 'S 出発地',
      address: pickupAddress.trim() || '—',
    },
  ]
  viaAddresses
    .map((address) => address.trim())
    .filter(Boolean)
    .forEach((address, index) => {
      points.push({
        role: 'via',
        title: `経由地${index + 1}`,
        address,
      })
    })
  points.push({
    role: 'G',
    title: 'G 最終目的地',
    address: dropoffAddress.trim() || '—',
  })
  return points
}

/** @deprecated 互換用。新UIの料金確認は filterPositiveFareLines を使う */
export const ensureOperationalZeroLines = (
  breakdown: FareBreakdown,
): FareLineItem[] =>
  filterPositiveFareLines([
    ...breakdown.lineItems,
    { label: '待機料', amountYen: breakdown.waitingFareYen },
    { label: '付き添い料', amountYen: breakdown.escortFareYen },
    { label: '実費', amountYen: breakdown.expenseFareYen },
  ])

function DashboardModal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="pre-fixed-meter-modal" role="presentation" onClick={onClose}>
      <section
        className="pre-fixed-meter-modal__card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pre-fixed-meter-modal__header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">
            閉じる
          </button>
        </header>
        <div className="pre-fixed-meter-modal__body">{children}</div>
      </section>
    </div>
  )
}

export function PreFixedMeterDashboard({
  totalFareYen,
  breakdownLines,
  waitingActive,
  escortActive,
  waitingClockLabel,
  escortClockLabel,
  canToggleWaiting,
  canToggleEscort,
  canStartTrip,
  isTripStarting,
  isWorkSessionLoading = false,
  tripStarted,
  canSettle,
  settleSkipsConfirm,
  canNavigate,
  canAddAssist,
  canAddExpense,
  canChangeRoute,
  caseSaving,
  isClosed,
  actionNotice = '',
  showAttendanceReturnLink = false,
  onAttendanceReturn,
  onToggleWaiting,
  onToggleEscort,
  onStartTrip,
  onSettle,
  onViewRoute,
  onNavigate,
  onAssistEdit,
  onEquipmentEdit,
  onBasicFeeEdit,
  onExpenseEdit,
  onChangeRoute,
}: PreFixedMeterDashboardProps) {
  const [modal, setModal] = useState<ModalKind>(null)

  const openModal = (next: ModalKind) => {
    setModal(next)
  }

  const closeModal = () => setModal(null)

  const positiveLines = filterPositiveFareLines(breakdownLines)
  // tripStarted = fixedFareRun のみ。待機・付き添いでは切り替えない。
  const showSettleButton = tripStarted || settleSkipsConfirm

  const handlePrimaryAction = () => {
    if (!showSettleButton) {
      onStartTrip()
      return
    }
    if (settleSkipsConfirm) {
      onSettle()
      return
    }
    openModal('settle-confirm')
  }

  const handleAssistMenuAction = (action: () => void) => {
    closeModal()
    action()
  }

  const primaryDisabled = showSettleButton
    ? caseSaving || isClosed || !canSettle
    : // 旧右パネル「固定運賃で運行開始」と同じ + 勤務確認中
      !canStartTrip || isTripStarting || isWorkSessionLoading

  const primaryLabel = showSettleButton
    ? '清算'
    : isTripStarting
      ? '運行開始処理中…'
      : isWorkSessionLoading
        ? '確認中…'
        : '運行開始'

  return (
    <div className="pre-fixed-meter-dashboard" aria-label="事前確定運賃メーター">
      <div className="pre-fixed-meter-dashboard__main">
        <section className="pre-fixed-meter-total" aria-label="事前確定運賃">
          <header className="pre-fixed-meter-total__header">
            <h1>事前確定運賃</h1>
          </header>
          <div className="pre-fixed-meter-total__body">
            <p className="pre-fixed-meter-total__label">合計金額</p>
            <p className="pre-fixed-meter-total__amount">
              <strong>{formatFareYen(totalFareYen)}</strong>
              <span>円</span>
            </p>
            <hr className="pre-fixed-meter-total__divider" />
            <div className="pre-fixed-meter-timer" aria-label="待機・付き添い">
              <button
                type="button"
                className={`pre-fixed-meter-timer__btn pre-fixed-meter-timer__btn--wait${waitingActive ? ' is-active' : ''}`}
                disabled={!canToggleWaiting}
                onClick={onToggleWaiting}
              >
                <span className="pre-fixed-meter-timer__icon" aria-hidden>
                  ◷
                </span>
                <strong>{waitingActive ? '待機終了' : '待機開始'}</strong>
                <span className="pre-fixed-meter-timer__sub">待機時間</span>
                <span className="pre-fixed-meter-timer__clock">{waitingClockLabel}</span>
              </button>
              <button
                type="button"
                className={`pre-fixed-meter-timer__btn pre-fixed-meter-timer__btn--escort${escortActive ? ' is-active' : ''}`}
                disabled={!canToggleEscort}
                onClick={onToggleEscort}
              >
                <span className="pre-fixed-meter-timer__icon" aria-hidden>
                  ♿
                </span>
                <strong>{escortActive ? '付き添い終了' : '付き添い開始'}</strong>
                <span className="pre-fixed-meter-timer__sub">付き添い時間</span>
                <span className="pre-fixed-meter-timer__clock">{escortClockLabel}</span>
              </button>
            </div>
          </div>
        </section>

        <aside className="pre-fixed-meter-actions" aria-label="運行操作">
          <button
            type="button"
            className={`pre-fixed-meter-actions__btn pre-fixed-meter-actions__btn--primary${showSettleButton ? ' is-pay' : ''}`}
            disabled={primaryDisabled}
            onClick={handlePrimaryAction}
          >
            <span className="pre-fixed-meter-actions__icon" aria-hidden>
              {showSettleButton ? '▣' : '▶'}
            </span>
            <strong>{primaryLabel}</strong>
            <span className="pre-fixed-meter-actions__chevron" aria-hidden>
              ›
            </span>
          </button>

          <button
            type="button"
            className="pre-fixed-meter-actions__btn pre-fixed-meter-actions__btn--nav"
            disabled={!canNavigate || isClosed}
            onClick={() => openModal('nav')}
          >
            <span className="pre-fixed-meter-actions__icon" aria-hidden>
              ➤
            </span>
            <strong>ナビ開始</strong>
            <span className="pre-fixed-meter-actions__chevron" aria-hidden>
              ›
            </span>
          </button>

          <button
            type="button"
            className="pre-fixed-meter-actions__btn pre-fixed-meter-actions__btn--assist"
            disabled={isClosed}
            onClick={() => openModal('assist')}
          >
            <span className="pre-fixed-meter-actions__icon" aria-hidden>
              ♿
            </span>
            <strong>介助</strong>
            <span className="pre-fixed-meter-actions__chevron" aria-hidden>
              ›
            </span>
          </button>

          <button
            type="button"
            className="pre-fixed-meter-actions__btn pre-fixed-meter-actions__btn--fare"
            onClick={() => openModal('fare')}
          >
            <span className="pre-fixed-meter-actions__icon" aria-hidden>
              ≡
            </span>
            <strong>料金確認</strong>
            <span className="pre-fixed-meter-actions__chevron" aria-hidden>
              ›
            </span>
          </button>
        </aside>
      </div>

      {actionNotice ? (
        <p className="pre-fixed-meter-dashboard__action-notice" role="alert">
          {actionNotice}
          {showAttendanceReturnLink && onAttendanceReturn ? (
            <>
              {' '}
              <button
                type="button"
                className="pre-fixed-meter-dashboard__attendance-link"
                onClick={onAttendanceReturn}
              >
                出勤画面へ
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <p className="pre-fixed-meter-dashboard__notice" role="note">
        待機・付き添いは30分未満無料です。
      </p>

      {modal === 'nav' ? (
        <DashboardModal title="ナビ" onClose={closeModal}>
          <div className="pre-fixed-meter-modal__choice-list">
            <button
              type="button"
              className="pre-fixed-meter-modal__choice"
              onClick={() => {
                closeModal()
                onViewRoute()
              }}
            >
              <strong>確定ルートを確認</strong>
              <span>地図・S／経由地／G・距離・所要時間を表示</span>
            </button>
            <button
              type="button"
              className="pre-fixed-meter-modal__choice"
              disabled={!canNavigate}
              onClick={() => {
                closeModal()
                onNavigate()
              }}
            >
              <strong>ナビを起動</strong>
              <span>確定ルートでナビを開始</span>
            </button>
          </div>
        </DashboardModal>
      ) : null}

      {modal === 'assist' ? (
        <DashboardModal title="介助メニュー" onClose={closeModal}>
          <div className="pre-fixed-meter-modal__menu-grid">
            <button
              type="button"
              disabled={!canAddAssist}
              onClick={() => handleAssistMenuAction(onAssistEdit)}
            >
              介助
            </button>
            <button
              type="button"
              disabled={!canAddAssist}
              onClick={() => handleAssistMenuAction(onEquipmentEdit)}
            >
              機材
            </button>
            <button
              type="button"
              disabled={!canAddAssist}
              onClick={() => handleAssistMenuAction(onBasicFeeEdit)}
            >
              基本
            </button>
            <button
              type="button"
              disabled={!canAddExpense}
              onClick={() => handleAssistMenuAction(onExpenseEdit)}
            >
              実費
            </button>
            <button
              type="button"
              disabled={!canChangeRoute}
              onClick={() => handleAssistMenuAction(onChangeRoute)}
            >
              ルート変更
            </button>
          </div>
        </DashboardModal>
      ) : null}

      {modal === 'fare' ? (
        <DashboardModal title="料金確認" onClose={closeModal}>
          {positiveLines.length === 0 ? (
            <p className="pre-fixed-meter-modal__empty">表示する料金項目はありません。</p>
          ) : (
            <dl className="pre-fixed-meter-fare-list">
              {positiveLines.map((line) => (
                <div key={`${line.label}-${line.amountYen}`}>
                  <dt>{line.label}</dt>
                  <dd>{formatFareYen(line.amountYen)}円</dd>
                </div>
              ))}
              <div className="pre-fixed-meter-fare-list__total">
                <dt>合計金額</dt>
                <dd>{formatFareYen(totalFareYen)}円</dd>
              </div>
            </dl>
          )}
        </DashboardModal>
      ) : null}

      {modal === 'settle-confirm' ? (
        <DashboardModal title="清算の確認" onClose={closeModal}>
          <dl className="pre-fixed-meter-fare-list">
            <div>
              <dt>現在の合計金額</dt>
              <dd>{formatFareYen(totalFareYen)}円</dd>
            </div>
            <div>
              <dt>待機</dt>
              <dd>{waitingActive ? `稼働中（${waitingClockLabel}）` : '停止中'}</dd>
            </div>
            <div>
              <dt>付き添い</dt>
              <dd>{escortActive ? `稼働中（${escortClockLabel}）` : '停止中'}</dd>
            </div>
          </dl>
          {waitingActive || escortActive ? (
            <p className="pre-fixed-meter-modal__empty">
              稼働中の待機・付き添いは清算時に既存ルールで確定・停止します。
            </p>
          ) : null}
          <p className="pre-fixed-meter-modal__empty">
            清算後は精算画面へ進み、レシート印刷・A4領収書・PDF保存が利用できます。
          </p>
          <div className="pre-fixed-meter-modal__choice-list">
            <button
              type="button"
              className="pre-fixed-meter-modal__choice"
              disabled={caseSaving || !canSettle}
              onClick={() => {
                closeModal()
                onSettle()
              }}
            >
              <strong>清算して精算画面へ</strong>
              <span>運行を終了し、領収書・レシート発行へ進みます</span>
            </button>
            <button
              type="button"
              className="pre-fixed-meter-modal__choice"
              onClick={closeModal}
            >
              <strong>キャンセル</strong>
              <span>メーター画面に戻ります</span>
            </button>
          </div>
        </DashboardModal>
      ) : null}
    </div>
  )
}
