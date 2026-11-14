export const BADGE_LINK = 'https://www.npmjs.com/package/agent-ready';

export function badgeColor(score: number): string {
  if (score >= 90) return 'brightgreen';
  if (score >= 75) return 'green';
  if (score >= 60) return 'yellow';
  if (score >= 40) return 'orange';
  return 'red';
}

export function badgeUrl(score: number): string {
  return `https://img.shields.io/badge/agent--ready-${score}%2F100-${badgeColor(score)}`;
}

export function badgeMarkdown(score: number): string {
  return `[![agent-ready: ${score}/100](${badgeUrl(score)})](${BADGE_LINK})`;
}
