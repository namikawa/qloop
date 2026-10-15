import { useId } from 'react';
import { CheckCircleIcon } from './icons';

interface PatternFieldProps<P extends string> {
  options: readonly { value: P; label: string; description: string }[];
  value: P;
  onChange: (value: P) => void;
}

/**
 * 出題パターンの選択（2 列のカード）。ラジオボタンの名前はパターン名だけにし、説明は aria-describedby で添える。
 */
export function PatternField<P extends string>({ options, value, onChange }: PatternFieldProps<P>) {
  const idPrefix = useId();
  return (
    <fieldset className="field">
      <legend className="field-legend">出題パターン</legend>
      <div className="pattern-options">
        {options.map((option) => {
          const inputId = `${idPrefix}-${option.value}`;
          const descriptionId = `${inputId}-description`;
          return (
            <div key={option.value} className="pattern-option">
              <input
                id={inputId}
                type="radio"
                className="overlay-input"
                name="pattern"
                checked={value === option.value}
                aria-describedby={descriptionId}
                onChange={() => onChange(option.value)}
              />
              <div className="pattern-card">
                <label htmlFor={inputId} className="pattern-name">
                  {option.label}
                </label>
                <span id={descriptionId} className="pattern-desc">
                  {option.description}
                </span>
                <CheckCircleIcon className="pattern-check" />
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
