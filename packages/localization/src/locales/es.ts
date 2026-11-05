import type { LocaleResource } from '../index';

/**
 * Spanish resource (second shipped locale; 'es' base covers 'es-MX',
 * 'es-AR', … via the base-language match in selectLocale).
 *
 * The "summaries only" labels are the SAFETY-POLICY.md 2/6/10 disclosure,
 * rendered next to every guide body. Content itself is localized server-
 * side through the guide API's `language` filter; these strings are UI
 * chrome only.
 */
export const es: LocaleResource = {
  locale: 'es',
  strings: {
    localeName: 'Español',
    direction: 'ltr',
    guidesTitle: 'Guías de seguridad',
    guidesSub:
      'Orientación protectora revisada y específica por tipo de riesgo, con ' +
      'referencias de fuentes, fechas de revisión y alcance de jurisdicción. ' +
      'Resúmenes de la orientación oficial, nunca un reemplazo de ella.',
    summariesOnly:
      'Solo resúmenes — no son instrucciones oficiales. Siga las ' +
      'instrucciones de emergencia locales y oficiales; tienen prioridad ' +
      'sobre esta guía.',
    notOfficial:
      'SENTRAVYN es una plataforma de información y preparación. No sustituye ' +
      'a los servicios de emergencia locales, las alertas oficiales, la ' +
      'atención médica profesional ni las instrucciones de evacuación del ' +
      'gobierno.',
    noGuideForHazard:
      'Aún no hay una guía revisada para este riesgo. SENTRAVYN no fabrica ' +
      'orientación: un riesgo sin guía revisada y citada se muestra vacío, ' +
      'nunca relleno con texto sin revisar.',
    staleLabel:
      'Desactualizado — esta guía no ha sido revisada de nuevo dentro de la ' +
      'ventana anual de revisión. Se muestra la fecha de última revisión; ' +
      'trátela con precaución y prefiera fuentes oficiales.',
    lastReviewed: 'Última revisión',
    version: 'Versión',
    authority: 'Autoridad',
    references: 'Referencias de fuentes',
    revisionHistory: 'Historial de revisiones',
    hazard: 'Riesgo',
    language: 'Idioma',
    loading: 'Cargando guías…',
    error: 'No se pudo cargar la guía. La API puede estar fuera de línea o la solicitud falló.',
    offline: 'Parece que no hay conexión. No se pudo obtener la guía.',
    retry: 'Reintentar',
  },
};
