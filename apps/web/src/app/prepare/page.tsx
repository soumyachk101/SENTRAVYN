import type { Metadata } from 'next';
import '@/components/static-pages/static-pages.css';

/**
 * `/prepare` — household preparedness checklists (PRODUCT-SPEC.md 5
 * "Preparedness"). Clearly labelled general guidance, not emergency
 * instructions and not live data: no fabricated statistics, no hazard
 * claims, no official-order language (SAFETY-POLICY.md 1, 5, 6). Hazard-
 * specific authoritative guidance lives under /guides, reviewed and
 * versioned against official sources.
 */
export const metadata: Metadata = {
  title: 'Household preparedness',
  description:
    'Plain, practical checklists for household preparedness: an emergency ' +
    'kit, contact and meeting plans, pets and accessible formats. General ' +
    'guidance only — official local instructions always take precedence.',
};

interface Checklist {
  id: string;
  title: string;
  intro: string;
  items: string[];
}

/**
 * Curated, general preparedness material. Deliberately unsourced: these
 * are widely-known household-preparedness basics, not claims about a
 * specific incident or region. No numbers, no statistics, no promises.
 */
const CHECKLISTS: Checklist[] = [
  {
    id: 'kit',
    title: 'Emergency kit',
    intro:
      'A kit you can grab and carry. Keep it in one place, review it a few times a year, and replace items that run out — water, food, batteries and medication all have dates.',
    items: [
      'Water: enough for drinking for several days, per person (keep more in hot climates, and for infants, older or ill members of the household).',
      'Food that needs no cooking or refrigeration, for the same period, and that anyone in the household can eat.',
      'Flashlight or headlamp and spare batteries — not candles.',
      'A battery or hand-crank radio, or a way to receive official local warnings.',
      'A first-aid kit and copies of your prescriptions, with a current list of any medication you or your household take.',
      'Cash in small bills: card readers and ATMs can fail after a power outage.',
      'A means of communication that does not rely on cell towers working (for example a pre-arranged out-of-area contact and, where practical, a battery-powered charger).',
      'Whistle, dust mask, plastic sheeting and duct tape, in case of a structural incident.',
      'Copies of important documents (identification, insurance, a household plan) in a waterproof folder, and an up-to-date copy somewhere safe off-site or in cloud storage.',
      'Replacement keys, and any items an infant, elderly or disabled family member specifically needs.',
      'Fuel for your vehicle kept above half a tank where that is practical; know how to shut off your home’s gas, water and electricity.',
    ],
  },
  {
    id: 'contacts',
    title: 'Contacts and out-of-area contact',
    intro:
      'During a major event, local phone lines and texts are often congested, while a distant contact can reach both families. Pick one out-of-area contact and make sure everyone in the household knows the number and where to call or text.',
    items: [
      'Write down one out-of-area contact every household member can reach, and share that contact with all of them.',
      'Keep the phone numbers of local emergency services, your insurer, your utility companies, and your doctor, without assuming the phone book will be readable in an emergency.',
      'Agree in advance on who meets whom: who looks after whom if members of the household are separated.',
      'Make sure every adult in the household knows the numbers, not just one person.',
      'If you keep a paper list, keep it with the kit and a second copy with the documents folder.',
    ],
  },
  {
    id: 'meeting',
    title: 'Meeting points',
    intro:
      'Agree on two meeting points: one near your home (a specific doorway, not a whole street), and one outside your immediate area in case you cannot get back home. Revisit them if you move or if the places you choose close.',
    items: [
      'A nearby point: a specific, physical place just outside your usual area that you would reach on foot.',
      'An out-of-area point: for example a relative’s house or a well-known landmark outside your usual neighbourhood.',
      'If an official order says to shelter in place, follow it — meeting points are for the moment you are expected to move, and official instructions override any plan.',
      'Make sure everyone, including children, can get to the meeting point on their own if they are separated and cannot call.',
      'Keep the meeting-point details written down with your contacts list.',
    ],
  },
  {
    id: 'pets',
    title: 'Pets and animals',
    intro:
      'Plan for pets before you need to. Official shelters are not always pet-friendly, so your own plan usually has to cover them.',
    items: [
      'Food, water, a leash or carrier, and a crate or travel cage for each animal, with a short current history card (name, species, weight, behaviour, medical needs).',
      'Vaccination and medical records on paper, not only in a vet’s system.',
      'Identify which relatives, friends or pet hotels will accept your animals, and confirm in advance — “we might” is not a plan.',
      'A list of pet-friendly places you have actually checked, in case you have to move quickly.',
      'If an official instruction conflicts with keeping a pet with you (for example a strict no-animals shelter), follow the instruction: the plan for the animal has to be made ahead of time, not during the emergency.',
    ],
  },
  {
    id: 'accessible',
    title: 'Accessible formats and household needs',
    intro:
      'A household plan that only works for one healthy adult is not a household plan. Build in what each person actually needs so nobody is left to figure it out in the dark.',
    items: [
      'For anyone with a disability or chronic condition: the specific equipment, medication, power needs and help required, and where those items live.',
      'Backup power for medical equipment, with enough supply for the outage you have planned for, and a way to ask for help if it runs out.',
      'Keep critical information in more than one format: large print, audio, a trusted person who can read to them, or any format that works for that person.',
      'Check with each care provider which information they need to hand over to each other quickly, and where that lives.',
      'Practice the plan: a quick run-through of who picks up whom and what leaves the house, once a year or whenever the household changes.',
    ],
  },
];

export default function PreparePage() {
  return (
    <section className="info-page" aria-labelledby="prepare-heading">
      <p className="info-page__eyebrow">Preparedness</p>
      <h1 id="prepare-heading" className="info-title">
        Household preparedness
      </h1>
      <p className="info-sub">
        Practical, plain checklists to keep a household ready before an
        emergency. These are general preparedness basics, not emergency
        instructions: official local instructions and reviewed, hazard-specific
        safety guides always take precedence over anything on this page.
      </p>

      <div className="info-notice" role="note">
        <p className="info-notice__title">General guidance only</p>
        <p>
          These checklists are not hazard-specific and do not replace official
          emergency guidance for your region. Before a hazard you are actually
          facing (flood, wildfire, earthquake, public-health event, and so on),
          look at the reviewed safety guides and follow official instructions
          from local authorities.
        </p>
      </div>

      {CHECKLISTS.map((list) => (
        <div className="info-block" key={list.id}>
          <h2>{list.title}</h2>
          <p>{list.intro}</p>
          <ul className="info-checklist">
            {list.items.map((item) => (
              <li key={item.slice(0, 40)}>{item}</li>
            ))}
          </ul>
        </div>
      ))}

      <div className="info-block">
        <h2>Where to go next</h2>
        <ul>
          <li>
            For hazard-specific, reviewed guidance with official source
            references: the safety guides.
          </li>
          <li>
            For live, source-backed alerts in your region: the public alerts
            list, remembering that stale or expired records are always labelled
            as such.
          </li>
          <li>
            To keep this checklist current, review your kit and plan a few times
            a year and after any household change — an old plan is worse than no
            plan, because it gets trusted.
          </li>
        </ul>
      </div>
    </section>
  );
}
