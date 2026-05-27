import { generateMerchantKey, isMerchantKeyReliable, cleanDescription } from "../normalize/text";

export interface HistoricTransactionItem {
  description: string;
  merchant?: string | null;
  category: string;
  cleanDescription?: string;
}

export interface DescriptionMatchResult {
  category: string;
  cleanDescription: string;
  confidence: number;
  evidence: string;
}

export function matchDescriptionFromHistory(
  description: string,
  merchant: string | null | undefined,
  userHistory: HistoricTransactionItem[]
): DescriptionMatchResult | null {
  if (!userHistory || userHistory.length === 0) return null;

  const currentKey = generateMerchantKey(merchant || description);
  if (!isMerchantKeyReliable(currentKey)) {
    return null; // Don't do matching for highly generic keywords like "Pix", "TED", "Cash"
  }

  // Filter historical occurrences containing the same merchantKey
  const occurrences = userHistory.filter(h => {
    const key = generateMerchantKey(h.merchant || h.description);
    return key === currentKey;
  });

  if (occurrences.length < 3) {
    return null; // We need at least 3 data points to be sure of consistency
  }

  // Group by category and cleanDescription to see consistency
  const categoryCounts: Record<string, number> = {};
  const descriptionCounts: Record<string, number> = {};

  for (const occ of occurrences) {
    const cat = occ.category;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

    const cDesc = occ.cleanDescription || cleanDescription(occ.description);
    descriptionCounts[cDesc] = (descriptionCounts[cDesc] || 0) + 1;
  }

  // Find most frequent category
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  const [mostFrequentCategory, count] = sortedCategories[0];
  const ratio = count / occurrences.length;

  // Find most frequent clean description
  const sortedDescriptions = Object.entries(descriptionCounts).sort((a, b) => b[1] - a[1]);
  const mostFrequentDescription = sortedDescriptions[0]?.[0] || cleanDescription(description);

  // Confidence conditions
  if (occurrences.length >= 5 && ratio >= 0.90) {
    return {
      category: mostFrequentCategory,
      cleanDescription: mostFrequentDescription,
      confidence: 0.88,
      evidence: `Histórico Consistente: Esta despesa apareceu ${occurrences.length} vezes e em ${Math.round(ratio * 100)}% dos casos foi categorizada como "${mostFrequentCategory}".`
    };
  }

  if (occurrences.length >= 3 && ratio >= 0.80) {
    return {
      category: mostFrequentCategory,
      cleanDescription: mostFrequentDescription,
      confidence: 0.82,
      evidence: `Histórico Provável: Esta despesa apareceu ${occurrences.length} vezes e na maioria (${Math.round(ratio * 100)}%) correspondia a "${mostFrequentCategory}".`
    };
  }

  return null;
}
