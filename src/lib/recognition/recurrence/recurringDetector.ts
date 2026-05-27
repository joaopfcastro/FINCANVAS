import { generateMerchantKey } from "../normalize/text";

const KNOWN_SUBSCRIPTION_KEYS = [
  'netflix',
  'spotify',
  'youtube premium',
  'disney+',
  'hbo max',
  'globoplay',
  'prime video',
  'primevideo',
  'apple services',
  'google services',
  'claro',
  'vivo',
  'tim',
  'deezer',
  'academia',
  'smartfit',
  'aluguel',
  'condominio'
];

export function isKnownSubscription(description: string): boolean {
  const mKey = generateMerchantKey(description);
  return KNOWN_SUBSCRIPTION_KEYS.some(subKey => mKey.includes(subKey));
}

export interface HistoricalTransaction {
  description: string;
  amount: number;
  date: string; // YYYY-MM-DD or DD/MM/YYYY
}

export function detectRecurrenceFromHistory(
  description: string,
  amount: number,
  history: HistoricalTransaction[]
): { isRecurring: boolean; evidence: string | null } {
  if (isKnownSubscription(description)) {
    return {
      isRecurring: true,
      evidence: "Marca de assinatura digital e pagamento recorrente identificada na descrição."
    };
  }

  const mKey = generateMerchantKey(description);
  const matches = history.filter(h => generateMerchantKey(h.description) === mKey);

  if (matches.length < 2) {
    return { isRecurring: false, evidence: null };
  }

  // Parse dates and look for recurring intervals (e.g. roughly ~30 days)
  const parseDate = (dStr: string): Date | null => {
    try {
      if (dStr.includes('/')) {
        const [day, month, year] = dStr.split('/').map(Number);
        return new Date(year, month - 1, day);
      }
      return new Date(dStr);
    } catch {
      return null;
    }
  };

  const dates = matches
    .map(m => parseDate(m.date))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length < 2) {
    return { isRecurring: false, evidence: null };
  }

  // Calculate gaps in days
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const diffTime = Math.abs(dates[i].getTime() - dates[i - 1].getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    gaps.push(diffDays);
  }

  // Check if typical gap is approx. 28-32 days (monthly) or 6-8 days (weekly)
  const isMonthly = gaps.every(g => g >= 25 && g <= 35);
  const isWeekly = gaps.every(g => g >= 5 && g <= 9);

  if (isMonthly) {
    // Also check if amount is stable (variance < 10%)
    const amounts = matches.map(m => Math.abs(m.amount));
    const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const maxDiff = Math.max(...amounts.map(amt => Math.abs(amt - average)));
    if (maxDiff / average < 0.1) {
      return {
        isRecurring: true,
        evidence: `Padrão de recorrência mensal detectado historicamente com intervalo médio de ~30 dias e valores estáveis (R$ ${average.toFixed(2)}).`
      };
    }
  }

  return { isRecurring: false, evidence: null };
}
