import { useState, useCallback } from 'react';
import { collection, query, where, getDocs, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { shouldIncludeInSaldoTotal } from '../lib/pluggyNormalizer';
import { toast } from 'sonner';

// Keep type declarations simple and compatible with existing types in the app
export interface UserLike {
  uid: string;
  getIdToken?: () => Promise<string>;
}

export interface UserProfileLike {
  categories?: string[];
  pluggyItemIds?: string[];
}

export interface TransactionLike {
  id?: string;
  date: string;
  desc: string;
  amount: number;
  source: string;
  type: string;
  pluggyId?: string;
}

interface SyncOptions {
  force?: boolean;
  itemIds?: string[];
}

function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\sà-úâ-ûã-õç]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeKey(date: string, desc: string, amount: number, source: string, type: string): string {
  const normDate = (date || '').trim();
  const normDesc = normalizeText(desc);
  const formattedAmount = Number(amount || 0).toFixed(2);
  const normSource = normalizeText(source);
  const normType = (type || '').trim().toLowerCase();
  
  return `${normDate}|${normDesc}|${formattedAmount}|${normSource}|${normType}`;
}

async function safeJsonClient(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    return {
      success: false,
      error: `Formato inesperado (Status: ${response.status}). Conteúdo: ${text.substring(0, 150) || 'N/A'}`
    };
  }
  try {
    return await response.json();
  } catch {
    return {
      success: false,
      error: `Falha ao interpretar JSON retornado do servidor.`
    };
  }
}

export function usePluggySync(
  user: UserLike | null | undefined,
  profile: UserProfileLike | null | undefined,
  transactions: TransactionLike[],
  learnedRules: any[] = []
) {
  const [isSyncingPluggy, setIsSyncingPluggy] = useState(false);
  const [pluggySyncStep, setPluggySyncStep] = useState('');

  const syncPluggyNow = useCallback(async (options?: SyncOptions): Promise<boolean> => {
    if (!user) {
      toast.error('Usuário não autenticado.');
      return false;
    }

    // 1. Concurrent synchronization blocker
    if (isSyncingPluggy) {
      toast.warning('A sincronização já está em andamento.');
      return false;
    }

    // 2. Throttling Guard (30-second cooldown, bypassable via options.force)
    const cooldownMs = 30000;
    const cacheKey = `fincanvas_last_sync_pluggy_${user.uid}`;
    const lastSyncTimeStr = localStorage.getItem(cacheKey);
    const now = Date.now();
    
    if (!options?.force && lastSyncTimeStr) {
      const lastSyncTime = parseInt(lastSyncTimeStr, 10);
      if (now - lastSyncTime < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - (now - lastSyncTime)) / 1000);
        toast.info(`Sincronização recente realizada. Aguarde ${remainingSeconds}s ou force a atualização.`);
        return false;
      }
    }

    setIsSyncingPluggy(true);
    setPluggySyncStep('Verificando credenciais de integração da Pluggy...');

    try {
      // 3. SECURE Firebase ID token generation for request authentication
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (user.getIdToken) {
        try {
          const token = await user.getIdToken();
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
        } catch (tokenErr) {
          console.warn('[usePluggySync] Failed to fetch Firebase ID token:', tokenErr);
        }
      }

      // 4. Validate if Pluggy is properly configured on the backend
      const credentialsRes = await fetch('/api/pluggy/credentials_status', { headers });
      const credentialsData = await safeJsonClient(credentialsRes);
      
      if (!credentialsRes.ok || !credentialsData.configured) {
        toast.error('A integração da Pluggy não está configurada em Preferências.');
        setPluggySyncStep('Integração não configurada.');
        setIsSyncingPluggy(false);
        return false;
      }

      // 5. Select Item IDs (User Profile array fallback)
      const targetItemIds = options?.itemIds || profile?.pluggyItemIds || [];
      if (targetItemIds.length === 0) {
        toast.error('Nenhuma conta Pluggy vinculada para sincronizar.');
        setPluggySyncStep('Nenhuma conta localizada.');
        setIsSyncingPluggy(false);
        return false;
      }

      setPluggySyncStep('Conectando de forma segura ao gateway da Pluggy...');

      // 6. Trigger Backend Sync Endpoint
      const syncRes = await fetch('/api/pluggy/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          categories: profile?.categories || [],
          itemIds: targetItemIds,
          learnedRules
        })
      });

      const data = await safeJsonClient(syncRes);
      if (!syncRes.ok || !data.success) {
        throw new Error(data.message || data.error || 'Problema de resposta no servidor de sincronização.');
      }

      // 7. Upsert retrieved account balances in transactional Firestore logic
      const incomingAccounts = data.accounts || [];
      if (incomingAccounts.length > 0) {
        setPluggySyncStep('Sincronizando saldos de contas bancárias...');
        const balancesCol = collection(db, 'accountBalances');
        const qBalances = query(balancesCol, where('userId', '==', user.uid));
        const currentBalancesSnap = await getDocs(qBalances);
        
        const existingDocsMap = new Map<string, { id: string, includeInSaldoTotal: boolean, includeReason: string }>();
        currentBalancesSnap.docs.forEach(docSnap => {
          const bData = docSnap.data();
          if (bData.accountId) {
            existingDocsMap.set(bData.accountId, {
              id: docSnap.id,
              includeInSaldoTotal: bData.includeInSaldoTotal !== undefined ? bData.includeInSaldoTotal : true,
              includeReason: bData.includeReason || ''
            });
          }
        });

        for (const acc of incomingAccounts) {
          const existing = existingDocsMap.get(acc.accountId);
          let include = true;
          let reason = 'Saldo disponível';

          if (existing) {
            include = existing.includeInSaldoTotal;
            reason = existing.includeReason;
          } else {
            const decision = shouldIncludeInSaldoTotal(acc.accountType, acc.accountSubtype);
            include = decision.include;
            reason = decision.reason;
          }

          const docPayload = {
            userId: user.uid,
            provider: 'pluggy',
            itemId: acc.itemId || null,
            accountId: acc.accountId,
            bankName: acc.bankName,
            bankRawName: acc.bankRawName || null,
            accountName: acc.accountName,
            accountRawName: acc.accountRawName || null,
            accountLabel: acc.accountLabel,
            accountType: acc.accountType,
            accountSubtype: acc.accountSubtype || null,
            number: acc.number || null,
            balance: typeof acc.balance === 'number' ? acc.balance : 0,
            currencyCode: acc.currencyCode || 'BRL',
            includeInSaldoTotal: include,
            includeReason: reason,
            status: acc.status || 'ACTIVE',
            sourceRaw: acc.sourceRaw || null,
            lastSyncedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          if (existing) {
            const docRef = doc(db, 'accountBalances', existing.id);
            await setDoc(docRef, docPayload, { merge: true });
          } else {
            const docRef = doc(balancesCol);
            await setDoc(docRef, {
              ...docPayload,
              createdAt: serverTimestamp()
            });
          }
        }
      }

      const list: any[] = data.transactions || [];
      if (data.message) {
        toast.info(data.message);
      }

      if (list.length === 0) {
        setPluggySyncStep('Tudo atualizado! Nenhuma nova transação nos últimos 30 dias.');
        toast.success('Sincronização concluída! Seus saldos estão atualizados.');
        localStorage.setItem(cacheKey, Date.now().toString());
        return true;
      }

      setPluggySyncStep(`Encontrados ${list.length} lançamentos recentes. Analisando duplicidades...`);

      // 8. Deduplicate transaction results based on both pluggyId and secondary structural keys
      const existingCounts: Record<string, number> = {};
      const existingPluggyIds = new Set<string>();

      for (const t of transactions) {
        if (t.pluggyId) {
          existingPluggyIds.add(t.pluggyId);
        }
        const key = makeKey(t.date, t.desc, t.amount, t.source, t.type);
        existingCounts[key] = (existingCounts[key] || 0) + 1;
      }

      const filterToInsert: any[] = [];
      let skippedCount = 0;

      for (const candidate of list) {
        if (candidate.pluggyId && existingPluggyIds.has(candidate.pluggyId)) {
          skippedCount++;
          continue;
        }
        const key = makeKey(candidate.date, candidate.desc, candidate.amount, candidate.source, candidate.type);
        if (existingCounts[key] && existingCounts[key] > 0) {
          existingCounts[key]--;
          skippedCount++;
        } else {
          filterToInsert.push(candidate);
        }
      }

      if (filterToInsert.length === 0) {
        setPluggySyncStep(`Concluído: ${skippedCount} entradas descartadas pois já estavam gravadas.`);
        toast.success(`Contas atualizadas! Todas as novas transações já constavam no sistema.`);
        localStorage.setItem(cacheKey, Date.now().toString());
        return true;
      }

      setPluggySyncStep(`Reconhecendo transações com motor local. Gravando ${filterToInsert.length} transações...`);

      // 9. Write normalized transactions to firestore collection
      const transactionsCollectionRef = collection(db, 'transactions');

      for (const itemToSave of filterToInsert) {
        const docRef = doc(transactionsCollectionRef);
        await setDoc(docRef, {
          date: itemToSave.date,
          desc: itemToSave.desc,
          cat: itemToSave.cat,
          type: itemToSave.type,
          amount: itemToSave.amount,
          source: itemToSave.source,
          pluggyId: itemToSave.pluggyId,
          userId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          // Persist the full normalized metadata:
          rawAmount: itemToSave.rawAmount !== undefined ? itemToSave.rawAmount : null,
          sourceRaw: itemToSave.sourceRaw || null,
          bankRawName: itemToSave.bankRawName || null,
          accountRawName: itemToSave.accountRawName || null,
          accountLabel: itemToSave.accountLabel || null,
          accountId: itemToSave.accountId || null,
          itemId: itemToSave.itemId || null,
          pluggyType: itemToSave.pluggyType || null,
          accountType: itemToSave.accountType || null,
          accountSubtype: itemToSave.accountSubtype || null,
          operationType: itemToSave.operationType || null,
          paymentData: itemToSave.paymentData || null,
          merchant: itemToSave.merchant || null,
          detectedDirection: itemToSave.detectedDirection || itemToSave.type,
          directionConfidence: itemToSave.directionConfidence !== undefined ? itemToSave.directionConfidence : null,
          directionReason: itemToSave.directionReason || null,
          isLikelyInternalTransfer: itemToSave.isLikelyInternalTransfer !== undefined ? itemToSave.isLikelyInternalTransfer : false,
          shouldIgnoreInTotals: itemToSave.shouldIgnoreInTotals !== undefined ? itemToSave.shouldIgnoreInTotals : false,
        });
      }

      setPluggySyncStep(`Concluído! ${filterToInsert.length} transações adicionadas e reconhecidas localmente.`);
      toast.success(`${filterToInsert.length} transações importadas com sucesso!`);
      localStorage.setItem(cacheKey, Date.now().toString());
      return true;

    } catch (err: any) {
      console.error('[usePluggySync Error]:', err);
      toast.error(err.message || 'Falha na sincronização.');
      setPluggySyncStep('Ocorreu um erro durante a sincronização.');
      return false;
    } finally {
      setIsSyncingPluggy(false);
    }
  }, [user, profile, transactions, learnedRules, isSyncingPluggy]);

  return {
    syncPluggyNow,
    isSyncingPluggy,
    pluggySyncStep
  };
}
