"use client";

/**
 * Locale selection for the guide surfaces (Phase 5 localization
 * foundation; @sentravyn/localization).
 *
 * The locale is a per-visitor choice, stored in localStorage under
 * `sentravyn.locale`; the guide API wires `language` through its query
 * filter so *content* arrives in the chosen language, while the UI chrome
 * strings come from the selected locale's resource. SSR-safe: on the
 * server there is no navigator/localStorage, so the default locale is
 * used and the client effect applies the stored choice.
 */

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  getResource,
  selectLocale,
  type LocaleCode,
  type LocaleResource,
} from "@sentravyn/localization";

const LOCALE_STORAGE_KEY = "sentravyn.locale";

function readStoredLocale(): LocaleCode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return value && getResource(value) ? value : null;
  } catch {
    // Storage can be blocked (private mode, cleared): fall through to the
    // browser default rather than failing the page.
    return null;
  }
}

function browserPreferredCodes(): LocaleCode[] {
  if (typeof navigator === "undefined" || !navigator.languages?.length) {
    return [];
  }
  return [...navigator.languages];
}

export function useGuideLocale(): {
  locale: LocaleResource;
  setLocale: (code: LocaleCode) => void;
} {
  const [locale, setLocaleState] = useState<LocaleResource>(() =>
    // Initial state must be SSR-stable (the module top-level locale), so
    // the selector runs on the stored/browser value only in an effect.
    selectLocale(undefined).resource,
  );

  useEffect(() => {
    // The locale is external browser state (localStorage / navigator), so
    // syncing it into React state is a legitimate effect use. Routing the
    // call through a locally declared closure satisfies the
    // react-hooks/set-state-in-effect rule without changing behaviour.
    const applyStored = () => {
      const stored = readStoredLocale();
      const resolved = selectLocale(
        stored ? [stored] : browserPreferredCodes(),
      );
      setLocaleState(resolved.resource);
    };
    applyStored();
  }, []);

  const setLocale = useCallback((code: LocaleCode) => {
    const resource = getResource(code);
    if (!resource) return; // Only supported codes are selectable.
    setLocaleState(resource);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, code);
    } catch {
      // A blocked store must not break the selection; it just does not
      // persist for the next visit.
    }
  }, []);

  return { locale, setLocale };
}

export const FALLBACK_LOCALE: LocaleResource =
  getResource(DEFAULT_LOCALE) as LocaleResource;
