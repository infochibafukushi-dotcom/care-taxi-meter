import { useState } from 'react'
import { formatFareYen } from '../../services/fare'

type KeypadMode = 'care' | 'customFee' | 'expense'

type KeypadModalProps = {
  amountYen: number
  defaultName: string
  mode: KeypadMode
  title: string
  onClose: () => void
  onConfirm: (entry: { name: string; amountYen: number }) => void
}

const keypadKeys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00']

export function KeypadModal({
  amountYen,
  defaultName,
  mode,
  title,
  onClose,
  onConfirm,
}: KeypadModalProps) {
  const [inputValue, setInputValue] = useState(String(amountYen))
  const [name, setName] = useState(defaultName)


  const currentAmount = Number(inputValue || 0)

  const appendDigit = (digit: string) => {
    setInputValue((current) => {
      const nextValue = `${current === '0' ? '' : current}${digit}`
      return String(Number(nextValue || 0))
    })
  }

  const handleConfirm = () => {
    if (!name.trim() || currentAmount <= 0) {
      return
    }

    onConfirm({ name: name.trim(), amountYen: currentAmount })
  }

  return (
    <div className="keypad-backdrop" role="presentation">
      <section
        aria-labelledby="keypad-title"
        aria-modal="true"
        className="keypad-modal"
        role="dialog"
      >
        <header className="keypad-header">
          <div>
            <span>
              {mode === 'care'
                ? '介助料金入力'
                : mode === 'customFee'
                  ? 'その他料金入力'
                  : '実費入力'}
            </span>
            <h2 id="keypad-title">{title}</h2>
          </div>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </header>
        <label className="keypad-name-field">
          項目名
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="keypad-display">
          <span>入力金額</span>
          <strong>{formatFareYen(currentAmount)}円</strong>
        </div>
        <div className="keypad-grid" aria-label="テンキー">
          {keypadKeys.map((key) => (
            <button key={key} type="button" onClick={() => appendDigit(key)}>
              {key}
            </button>
          ))}
          <button type="button" onClick={() => setInputValue((value) => value.slice(0, -1) || '0')}>
            削除
          </button>
          <button type="button" onClick={() => setInputValue('0')}>
            クリア
          </button>
          <button className="keypad-confirm" type="button" onClick={handleConfirm}>
            {mode === 'customFee' ? '登録' : '決定'}
          </button>
        </div>
      </section>
    </div>
  )
}
