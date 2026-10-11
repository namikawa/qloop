interface SegmentedOption<T> {
  value: T;
  label: string;
}

interface SegmentedProps<T> {
  /** 項目名（fieldset の legend）。 */
  legend: string;
  /** 項目名を画面に出さず、読み上げにだけ使う。 */
  legendHidden?: boolean;
  /** ラジオボタンの name。 */
  name: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * 切り替えボタン（セグメント）。fieldset・legend・ラジオボタンの組み立てのまま、見た目だけを切り替えボタンにする。
 * ラジオボタンは透明にして各ボタンの全面に重ね、選んだ状態は隣の span（`input:checked + span`）で示す。
 */
export function Segmented<T extends string | number>({
  legend,
  legendHidden = false,
  name,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset className="field">
      <legend className={legendHidden ? 'visually-hidden' : 'field-legend'}>{legend}</legend>
      <div
        className="segmented"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <label key={option.value} className="segment">
            <input
              type="radio"
              className="overlay-input"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="segment-label">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
