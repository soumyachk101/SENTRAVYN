'use client';

/**
 * Locale selector for the guide surfaces (Phase 5 localization foundation).
 *
 * A small, accessible `<select>` over the shipped locales
 * (@sentravyn/localization SUPPORTED_LOCALES). Choosing a locale re-renders
 * the UI chrome in that language and re-fetches the guide content with the
 * matching `language` filter, so content and chrome stay in step.
 */

import {
  SUPPORTED_LOCALES,
  RESOURCES,
  type LocaleCode,
} from '@sentravyn/localization';

export function LocaleSelector({
  current,
  onChange,
  label,
}: {
  current: LocaleCode;
  onChange: (code: LocaleCode) => void;
  label: string;
}) {
  return (
    <label className="locale-select" htmlFor="locale-select">
      <span className="locale-select__label">{label}</span>
      <select
        id="locale-select"
        value={current}
        onChange={(e) => onChange(e.target.value as LocaleCode)}
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code}>
            {RESOURCES[code].strings.localeName}
          </option>
        ))}
      </select>
    </label>
  );
}
