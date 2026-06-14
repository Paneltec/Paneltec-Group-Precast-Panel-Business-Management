const audFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatAUD = (n) => {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return audFormatter.format(v);
};

export const formatNumber = (n, digits = 2) => {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return v.toLocaleString("en-AU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

export const formatDateTime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};
