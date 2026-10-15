import { CheckIcon } from './icons';

/** 本の見出しと単位のチップ。見出しの無い教材では従来のチップだけを並べる。 */
export function GroupChips({
  groups,
  groupHeading,
  groupChipLabel,
  selected,
  onToggle,
}: {
  groups: readonly string[];
  groupHeading: (group: string) => string | null;
  groupChipLabel: (group: string) => string;
  selected: readonly string[];
  onToggle: (group: string) => void;
}) {
  const headings = [...new Set(groups.map(groupHeading))];
  return headings.map((heading) => (
    <div className="chip-group" key={heading ?? ''}>
      {heading !== null && <h3 className="chip-heading">{heading}</h3>}
      <div className="chip-options">
        {groups
          .filter((group) => groupHeading(group) === heading)
          .map((group) => (
            <label key={group} className="chip">
              <input
                type="checkbox"
                className="overlay-input"
                checked={selected.includes(group)}
                onChange={() => onToggle(group)}
              />
              <span className="chip-label">
                <CheckIcon className="chip-check" />
                {groupChipLabel(group)}
              </span>
            </label>
          ))}
      </div>
    </div>
  ));
}
