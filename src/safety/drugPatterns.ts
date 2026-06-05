/**
 * Shared drug-name patterns used by more than one safety engine
 * (beers.ts, stopp.ts).
 *
 * Hoisted here after a 2026-06-05 audit found two silent-pass bugs of the
 * #234–236 honest-failure class:
 *   1. NSAID_RE was duplicated verbatim across beers.ts and stopp.ts and
 *      missed every Israeli brand + Hebrew NSAID name and ALL COX-2
 *      inhibitors. It feeds three CRITICAL rules (BEERS-NSAID-CKD,
 *      STOPP-NSAID-WARFARIN, STOPP-NSAID-DOAC) — a Hebrew/brand NSAID in a
 *      CKD or anticoagulated patient produced NO flag = silent pass on a
 *      nephrotoxicity / catastrophic-bleed interaction.
 *   2. PPI_RE had drifted: beers carried rabeprazole + four Hebrew PPI names
 *      that stopp lacked, so a Hebrew-named PPI fired BEERS-PPI-LONG but not
 *      STOPP-PPI-LONG.
 *
 * One definition per pattern = the drift cannot recur. drugPatterns.test.ts
 * locks the cross-engine coverage.
 *
 * Coverage philosophy (matches beers.ts CKD_RE comment): over-broad is the
 * safe direction here. These feed nephrotoxicity / bleed / deprescribing
 * flags where a false positive is one extra review line, never a missed
 * danger. Extracted med lists routinely arrive with Israeli brand names and
 * Hebrew transliterations verbatim, so both are first-class here.
 */

// NSAIDs incl. COX-2 inhibitors, Israeli brand names, and Hebrew names.
// Used by BEERS-NSAID-CKD and STOPP-NSAID-WARFARIN / STOPP-NSAID-DOAC — all
// critical-severity. `coxib` is the class catch-all (etoricoxib/celecoxib/
// parecoxib/valdecoxib); no non-NSAID drug name contains it.
export const NSAID_RE =
  /ibuprofen|naproxen|diclofenac|indomethacin|ketorolac|ketoprofen|mefenamic|piroxicam|meloxicam|etodolac|etoricoxib|celecoxib|coxib|nurofen|advil|voltaren|cataflam|arcoxia|etopan|mobic|movalis|naxyn|ponstan|feldene|ketonal|איבופרופן|נפרוקסן|וולטרן|דיקלופנק|אטופן|ארקוקסיה|נורופן|מלוקסיקאם/i;

// PPIs incl. Israeli brand names + Hebrew names. Used by BEERS-PPI-LONG and
// STOPP-PPI-LONG. Superset of both engines' former local definitions.
export const PPI_RE =
  /omeprazole|esomeprazole|pantoprazole|lansoprazole|rabeprazole|dexlansoprazole|losec|nexium|controloc|omepradex|אומפרזול|לוסק|פנטופרזול|קונטרולוק|נקסיום/i;
