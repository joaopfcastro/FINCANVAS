export function parseOFX(text: string): any[] {
  const transactions: any[] = [];
  
  // Clean line ending differences for easier matching
  const cleanedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Split the file by '<STMTTRN>' tag.
  const blocks = cleanedText.split(/<STMTTRN>/i);
  blocks.shift(); // Remove headers before first STMTTRN
  
  for (const block of blocks) {
    const stmtBlock = block.split(/<\/STMTTRN>/i)[0];
    
    // Helper to extract unclosed or closed tag values
    const getTagValue = (tagName: string): string => {
      const regex = new RegExp(`<${tagName}>([^<\n\r]+)`, 'i');
      const match = stmtBlock.match(regex);
      return match ? match[1].trim() : '';
    };

    const trntype = getTagValue('TRNTYPE');
    const dtposted = getTagValue('DTPOSTED');
    const trnamt = getTagValue('TRNAMT');
    const fitid = getTagValue('FITID');
    const name = getTagValue('NAME');
    const memo = getTagValue('MEMO');

    if (trnamt) {
      let dateFormatted = '';
      const dateMatch = dtposted.match(/^(\d{8})/);
      if (dateMatch) {
        const dateRaw = dateMatch[1];
        dateFormatted = `${dateRaw.substring(6, 8)}/${dateRaw.substring(4, 6)}/${dateRaw.substring(0, 4)}`;
      } else {
        const d = new Date();
        dateFormatted = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }

      // Preserve original sign
      const amountValue = parseFloat(trnamt.replace(',', '.'));
      if (isNaN(amountValue)) {
        continue;
      }

      // Prioritize MEMO, then NAME, then FITID
      const desc = memo || name || fitid || 'Transação OFX';
      const isDespesa = amountValue < 0 || trntype.toUpperCase() === 'DEBIT';

      transactions.push({
        date: dateFormatted,
        desc: desc,
        amount: amountValue,
        type: isDespesa ? 'Despesa' : 'Receita',
        source: 'Importação OFX'
      });
    }
  }
  return transactions;
}

export function parseCSV(text: string): any[] {
  const transactions: any[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length <= 1) return [];
  
  const firstLine = lines[0];
  let delimiter = ',';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  
  if (semiCount > commaCount && semiCount > tabCount) {
    delimiter = ';';
  } else if (tabCount > commaCount && tabCount > semiCount) {
    delimiter = '\t';
  }
  
  const splitLine = (line: string, delim: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delim && !inQuotes) {
        result.push(current.trim().replace(/^["']|["']$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^["']|["']$/g, ''));
    return result;
  };
  
  const headers = splitLine(lines[0], delimiter).map(h => h.toLowerCase());
  
  const dateAliases = ['data', 'date', 'dt', 'lançamento', 'lancamento', 'movimentacao', 'movimentação'];
  const dateIdx = headers.findIndex(h => dateAliases.some(alias => h.includes(alias)));
  
  const descAliases = ['descrição', 'descricao', 'histórico', 'historico', 'memo', 'name', 'descrição do lançamento', 'detalhe', 'estabelecimento', 'desc'];
  const descIdx = headers.findIndex(h => descAliases.some(alias => h.includes(alias)));
  
  const valAliases = ['valor', 'amount', 'valor r$', 'vlr', 'lançado', 'lancado', 'total'];
  const valIdx = headers.findIndex(h => valAliases.some(alias => h.includes(alias)));
  
  const creditAliases = ['credito', 'crédito', 'entrada', 'entradas', 'credit', 'receita', 'receitas'];
  const creditIdx = headers.findIndex(h => creditAliases.some(alias => h.includes(alias)));
  
  const debitAliases = ['debito', 'débito', 'saida', 'saídas', 'saidas', 'debit', 'despesa', 'despesas'];
  const debitIdx = headers.findIndex(h => debitAliases.some(alias => h.includes(alias)));
  
  const typeAliases = ['tipo', 'type', 'natureza', 'operacao', 'operação'];
  const typeIdx = headers.findIndex(h => typeAliases.some(alias => h.includes(alias)));
  
  const catAliases = ['categoria', 'category', 'cat'];
  const catIdx = headers.findIndex(h => catAliases.some(alias => h.includes(alias)));
  
  const srcAliases = ['conta', 'source', 'origem', 'banco', 'institution', 'card'];
  const srcIdx = headers.findIndex(h => srcAliases.some(alias => h.includes(alias)));
  
  const parseNumValue = (valStr: string): number => {
    let clean = valStr.trim();
    if (!clean) return 0;
    
    let isNegative = false;
    if (clean.startsWith('(') && clean.endsWith(')')) {
      isNegative = true;
      clean = clean.substring(1, clean.length - 1).trim();
    }
    
    if (clean.includes(',')) {
      if (clean.includes('.')) {
        clean = clean.replace(/\./g, '');
      }
      clean = clean.replace(',', '.');
    }
    
    let parsed = parseFloat(clean);
    if (isNaN(parsed)) return 0;
    if (isNegative && parsed > 0) {
      parsed = -parsed;
    }
    return parsed;
  };
  
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], delimiter);
    if (cols.length < 2) continue;
    
    let dateStr = '';
    if (dateIdx !== -1 && cols[dateIdx]) {
      dateStr = cols[dateIdx];
    } else {
      const foundDate = cols.find(col => col && /(\d{2,4})[/-](\d{2})[/-](\d{2,4})/.test(col));
      dateStr = foundDate || '';
    }
    dateStr = dateStr.trim();
    if (!dateStr) continue;
    
    let desc = 'Transação CSV';
    if (descIdx !== -1 && cols[descIdx]) {
      desc = cols[descIdx];
    } else {
      const fallbackCol = cols.find((col, colIdx) => {
        return colIdx !== dateIdx && colIdx !== valIdx && colIdx !== creditIdx && colIdx !== debitIdx && col.length > 3 && isNaN(Number(col));
      });
      if (fallbackCol) desc = fallbackCol;
    }
    desc = desc.trim();
    
    let amount = 0;
    let typeResolved: 'Receita' | 'Despesa' | '' = '';
    
    if (valIdx !== -1 && cols[valIdx]) {
      amount = parseNumValue(cols[valIdx]);
    } else if (creditIdx !== -1 || debitIdx !== -1) {
      const creditVal = creditIdx !== -1 && cols[creditIdx] ? parseNumValue(cols[creditIdx]) : 0;
      const debitVal = debitIdx !== -1 && cols[debitIdx] ? parseNumValue(cols[debitIdx]) : 0;
      
      if (creditVal !== 0 && debitVal === 0) {
        amount = Math.abs(creditVal);
        typeResolved = 'Receita';
      } else if (debitVal !== 0 && creditVal === 0) {
        amount = -Math.abs(debitVal);
        typeResolved = 'Despesa';
      } else if (creditVal !== 0 && debitVal !== 0) {
        amount = creditVal - debitVal;
      }
    }
    
    if (!typeResolved) {
      if (typeIdx !== -1 && cols[typeIdx]) {
        const typeStr = cols[typeIdx].toLowerCase();
        if (typeStr.includes('c') || typeStr.includes('receita') || typeStr.includes('credito') || typeStr.includes('crédito') || typeStr.includes('entrada')) {
          typeResolved = 'Receita';
        } else if (typeStr.includes('d') || typeStr.includes('despesa') || typeStr.includes('debito') || typeStr.includes('débito') || typeStr.includes('saida')) {
          typeResolved = 'Despesa';
        }
      }
    }
    
    if (!typeResolved) {
      typeResolved = amount < 0 ? 'Despesa' : 'Receita';
    }
    
    if (typeResolved === 'Despesa' && amount > 0) {
      amount = -amount;
    } else if (typeResolved === 'Receita' && amount < 0) {
      amount = Math.abs(amount);
    }
    
    let source = 'Importação CSV';
    if (srcIdx !== -1 && cols[srcIdx]) {
      source = `CSV: ${cols[srcIdx]}`;
    }
    
    let category = '';
    if (catIdx !== -1 && cols[catIdx]) {
      category = cols[catIdx];
    }
    
    transactions.push({
      date: dateStr,
      desc: desc,
      amount: amount,
      type: typeResolved,
      source: source,
      originalCategory: category || undefined
    });
  }
  
  return transactions;
}
