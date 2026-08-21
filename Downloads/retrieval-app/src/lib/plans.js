/* ─── Plans & entitlements ───
 * Single source of truth for what each pricing plan unlocks. Used by the UI to
 * hide/disable features and by the admin Schools & Plans view. The LOAD-BEARING
 * gate (custom question authoring) is also enforced server-side by RLS
 * (school_plan_allows_custom_questions) so hiding the button isn't the only thing
 * stopping a non-Core school — the UI gate is convenience, the RLS gate is security.
 *
 * The plan lives on the school row (schools.plan); attachProfile (roles.js) embeds it
 * as user.profile.school, so planOf(user) works anywhere a `user` is in scope. */

export const SCHOOL_ANNUAL_PRICE_GBP = 800;
export const SCHOOL_ANNUAL_PRICE_LABEL = `£${SCHOOL_ANNUAL_PRICE_GBP}`;

export const PLANS = {
  free: {
    key: "free", label: "Starter", priceLabel: "Free",
    customQuestions: false, leadership: false, mis: false,
    maxClasses: 1, markCap: { period: "month", n: 2000 },
  },
  essentials: {
    key: "essentials", label: "Legacy Essentials", priceLabel: "Legacy plan",
    customQuestions: false, leadership: false, mis: false,
    maxPupils: 600, markCap: { period: "term", n: 250000 },
  },
  core: {
    key: "core", label: "School", priceLabel: `${SCHOOL_ANNUAL_PRICE_LABEL} / school / yr`,
    customQuestions: true, leadership: true, mis: true,
    markCap: { period: "term", perPupil: 1500 },
  },
  single_cohort: {
    key: "single_cohort", label: "Legacy single cohort", priceLabel: "Legacy plan",
    customQuestions: true, leadership: true, mis: "addon",
    markCap: { period: "term", perPupil: 1500 },
  },
};

// New schools use the single School plan. Legacy keys remain selectable so an
// existing record can still be viewed or deliberately migrated by a moderator.
export const PLAN_ORDER = ["free", "core", "essentials", "single_cohort"];

/* The school's plan key for a user (defaults to free if unset/unknown). */
export function planKey(user) {
  return user?.profile?.school?.plan || "free";
}

/* The full plan descriptor for a user. */
export function planOf(user) {
  return PLANS[planKey(user)] || PLANS.free;
}

export function planLabel(keyOrUser) {
  const k = typeof keyOrUser === "string" ? keyOrUser : planKey(keyOrUser);
  return PLANS[k]?.label || "Starter";
}

/* Does this user's plan unlock a feature? Moderators bypass every gate (platform admin),
 * matching the server-side is_moderator() carve-out. */
export function planAllows(user, feature) {
  if (user?.profile?.role === "moderator") return true;
  const v = planOf(user)[feature];
  return v === true || v === "addon"; // 'addon' = available, sold separately
}

/* The fair-use mark allowance for a school row, derived from its plan + committed
 * pupils. Returns null when the plan has no fixed cap (e.g. moderator/unknown). */
export function markAllowance(school) {
  const plan = PLANS[school?.plan];
  if (!plan) return null;
  if (school?.marks_allowance) return Number(school.marks_allowance); // explicit override wins
  const cap = plan.markCap;
  if (!cap) return null;
  if (cap.n) return cap.n;
  if (cap.perPupil && school?.committed_pupils) return cap.perPupil * Number(school.committed_pupils);
  return null;
}
