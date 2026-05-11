export const MARKET_TIME_ZONE = 'America/New_York';

export function formatEtRoundWindow(startAt: number, endAt: number) {
  const date = formatEtRoundDate(startAt);
  const start = formatEtCompactTime(startAt);
  const end = formatEtCompactTime(endAt);
  return `${date}, ${start}-${end} ET`;
}

export function formatEtRoundDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: MARKET_TIME_ZONE
  }).format(new Date(timestamp * 1000));
}

export function formatEtCompactTime(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: MARKET_TIME_ZONE
  }).format(new Date(timestamp * 1000)).replace(/\s/g, '');
}

export function formatEtRoundTime(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: MARKET_TIME_ZONE
  }).format(new Date(timestamp * 1000)).replace(/\s/g, ' ');
}

export function formatEtChartTime(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: MARKET_TIME_ZONE
  }).format(new Date(timestamp * 1000));
}
