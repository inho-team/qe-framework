/** Match a concrete semver against the manifest's numeric/x compatibility form. */
export function frameworkRangeMatchesVersion(range, version) {
  const actual = String(version || '').split('-', 1)[0].split('+', 1)[0].split('.');
  const declared = String(range || '').split('.');
  if (actual.length !== 3 || declared.length < 1 || declared.length > 3) return false;
  if (!actual.every((part) => /^\d+$/.test(part))) return false;
  return declared.every((part, index) => /^(?:x|\*)$/i.test(part) || part === actual[index]);
}

/** Return the schema compatibility declaration covering a framework version. */
export function findSchemaCompatibility(manifest, version) {
  const entries = Array.isArray(manifest?.frameworkCompatibility)
    ? manifest.frameworkCompatibility
    : [];
  return entries.find((entry) => frameworkRangeMatchesVersion(entry?.framework, version)) || null;
}
