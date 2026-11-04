/**
 * Static preparedness content for the landing surface.
 *
 * These are general preparedness facts, NOT emergency instructions and NOT
 * live data (SAFETY-POLICY.md 1, PRODUCT-SPEC.md 1). They are safe to ship in
 * Phase 1 because they are curated, not source-attributed claims about a
 * specific incident. Hazard-specific guidance that carries authority,
 * review dates and versions arrives in Phase 5 (docs/ROADMAP.md).
 */

export const safety = {
  modules: [
    {
      id: "alerts",
      index: "01",
      title: "Emergency alerts",
      body: "Authoritative, source-backed alerts with issuer, issue time, " +
        "affected area and freshness. Every alert shows where it came from.",
    },
    {
      id: "guides",
      index: "02",
      title: "Safety guides",
      body: "Reviewed, hazard-specific protective guidance with source " +
        "references, review dates and jurisdiction applicability.",
    },
    {
      id: "map",
      index: "03",
      title: "Emergency map",
      body: "Hospitals, clinics, fire and police services and officially " +
        "verified shelters. Distance is a calculation, never a safety call.",
    },
    {
      id: "preparedness",
      index: "04",
      title: "Household preparedness",
      body: "Emergency kit checklists, household plans, contact lists and " +
        "meeting points you can revisit offline.",
    },
  ],
  limitations: [
    "A nearby place is not automatically a safe shelter.",
    "Stale information is always shown as stale, never as current.",
    "Official local emergency instructions take precedence over SENTRAVYN guidance.",
    "SENTRAVYN does not predict events or certify buildings as safe.",
  ],
  disclaimer:
    "SENTRAVYN is an information and preparedness platform. It is not a " +
    "substitute for local emergency services, official warnings, professional " +
    "medical care or government evacuation instructions.",
};
