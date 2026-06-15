export const formatAUD = (n: any): string => {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
};

export const formatNumber = (n: any, digits = 2): string => {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return v.toLocaleString('en-AU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export const relTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  const h = Math.round(diff / 3600000);
  const d = Math.round(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-AU');
};
