// Uppercase and keep only A–Z: "ember fang", "Ember-Fang" and "EMBERFANG" all become "EMBERFANG".
export function normalize(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, '');
}
