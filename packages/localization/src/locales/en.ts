import type { LocaleResource } from '../index';

/**
 * English resource (the default locale).
 *
 * Every string here is reviewed UI chrome for the guide surfaces — it is
 * not emergency instruction. The "summaries only" labels are the
 * SAFETY-POLICY.md 2/6/10 disclosure, rendered next to every guide body.
 */
export const en: LocaleResource = {
  locale: 'en',
  strings: {
    localeName: 'English',
    direction: 'ltr',
    guidesTitle: 'Safety guides',
    guidesSub:
      'Reviewed, hazard-specific protective guidance with source references, ' +
      'review dates and jurisdiction applicability. Summaries of official ' +
      'guidance, never a replacement for it.',
    summariesOnly:
      'Summaries only — not official instructions. Follow official local ' +
      'emergency instructions; they take precedence over this guidance.',
    notOfficial:
      'SENTRAVYN is an information and preparedness platform. It is not a ' +
      'substitute for local emergency services, official warnings, professional ' +
      'medical care or government evacuation instructions.',
    noGuideForHazard:
      'No reviewed guide for this hazard yet. SENTRAVYN does not fabricate ' +
      'guidance: a hazard without a reviewed, cited guide is shown as empty, ' +
      'never filled with unreviewed text.',
    staleLabel:
      'Stale — this guide has not been re-reviewed within the annual review ' +
      'window. The last review date is shown; treat it with extra caution and ' +
      'prefer official sources.',
    lastReviewed: 'Last reviewed',
    version: 'Version',
    authority: 'Authority',
    references: 'Source references',
    revisionHistory: 'Revision history',
    hazard: 'Hazard',
    language: 'Language',
    loading: 'Loading guides…',
    error: 'The guide could not be loaded. The API may be offline or the request failed.',
    offline: 'You appear to be offline. The guide could not be fetched.',
    retry: 'Retry',
  },
};
