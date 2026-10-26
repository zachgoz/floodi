import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from 'src/contexts/AuthContext';
import { changeCitizenAlerts, readCitizenAlerts, type CitizenAction, type CitizenStatusResponse } from 'src/lib/citizenAlerts';

export function useCitizenAlerts(guestRead = true) {
  const { user, loading: authLoading, isAnonymous } = useAuth();
  const account = user && !isAnonymous ? user : null;
  const uid = account?.uid ?? null;
  const [snapshot, setSnapshot] = useState<{ uid: string | null; value: CitizenStatusResponse } | null>(null);
  const [reading, setReading] = useState(false);
  const [mutatingUid, setMutatingUid] = useState<string | null>(null);
  const mutation = useRef<{ uid: string; id: symbol } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identity = useRef(uid);
  identity.current = uid;
  const sequence = useRef(0);
  const [refreshNumber, setRefreshNumber] = useState(0);
  const refresh = useCallback(() => setRefreshNumber(n => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++sequence.current;
    setError(null);
    if (authLoading || (!account && !guestRead)) { setReading(false); return () => controller.abort(); }
    setReading(true);
    void readCitizenAlerts(account, controller.signal).then(value => {
      if (!controller.signal.aborted && sequence.current === requestId && identity.current === uid) setSnapshot({ uid, value });
    }).catch((e: Error) => {
      if (!controller.signal.aborted && sequence.current === requestId && identity.current === uid) setError(e.message);
    }).finally(() => {
      if (!controller.signal.aborted && sequence.current === requestId) setReading(false);
    });
    return () => controller.abort();
  }, [uid, authLoading, guestRead, refreshNumber, account]);

  useEffect(() => {
    window.addEventListener('floodcast:alerts-updated', refresh);
    return () => window.removeEventListener('floodcast:alerts-updated', refresh);
  }, [refresh]);

  const change = async (action: CitizenAction) => {
    if (!account || mutation.current?.uid === account.uid) return;
    const forUid = account.uid;
    const id = Symbol();
    mutation.current = { uid: forUid, id };
    ++sequence.current;
    setReading(false); setMutatingUid(forUid); setError(null);
    try {
      const value = await changeCitizenAlerts(account, action);
      if (identity.current === forUid) { setSnapshot({ uid: forUid, value }); return value; }
      return undefined;
    } catch (e) {
      if (identity.current === forUid) setError(e instanceof Error ? e.message : 'Please try again.');
      return undefined;
    } finally {
      if (mutation.current?.id === id) { mutation.current = null; setMutatingUid(null); }
    }
  };
  // A response from a previous account is never displayed after sign-out/switch.
  return { data: snapshot?.uid === uid ? snapshot.value : null, busy: reading || (uid !== null && mutatingUid === uid), error, refresh, change, user: account, authLoading };
}
