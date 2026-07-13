// parseHelpFlag — Detects /Qxxx or $Qxxx --help/-h patterns.

export function parseHelpFlag(message) {
  const trimmed = message.trim();
  const regex = /^[$/](Q[A-Za-z-]+|M[A-Za-z-]+)\s+(--help|-h)(\s|$)/;
  const match = regex.exec(trimmed);

  if (match) {
    return { matched: true, skillName: match[1] };
  }

  return { matched: false, skillName: null };
}
