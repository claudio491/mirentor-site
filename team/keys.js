// keys.js: what the return key of a phone's keyboard does in a form, away from the page so it can be tested.
// In a run of fields it reads "next" and moves to the next field shown; on the last one it reads "done". A number field
// gets the digit pad as text, never type=number (full keyboard on an iPhone, "12a" silently read as empty).

/** For fields in order, whether each is shown: the key's label and where Enter moves (the index, or null on the last). */
export function enterPlan(shown) {
  return shown.map((_, i) => {
    const to = shown.findIndex((on, j) => j > i && on);
    return to >= 0 ? { hint: 'next', to } : { hint: 'done', to: null };
  });
}

/** The attributes of a field that takes a whole number. */
export const numberAttrs = () => ({ type: 'text', inputmode: 'numeric', pattern: '[0-9]*' });
