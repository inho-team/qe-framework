/**
 * Agent Teams detection utilities.
 * Checks env var and hook input for team context.
 */

/**
 * Check if Agent Teams feature is enabled via environment variable.
 */
export function isTeamsEnabled() {
  return process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
}

/**
 * Extract team context from hook input data.
 * Returns { isTeam, teamName, teammateName } or { isTeam: false } if not in a team.
 */
export function getTeamContext(data) {
  const teammateName = data?.teammate_name || data?.teammateName || null;
  const teamName = data?.team_name || data?.teamName || null;

  if (teammateName && teamName) {
    return { isTeam: true, teamName, teammateName };
  }

  return { isTeam: false, teamName: null, teammateName: null };
}
