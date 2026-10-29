import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from 'src/contexts/AuthContext';
import * as citizenAlertsApi from 'src/lib/citizenAlerts';
import type {
  CitizenAction,
  CitizenAlertPreferences,
  CitizenStatusResponse,
  PublicAlertFeedDocument,
} from 'src/lib/citizenAlerts';

export function useCitizenAlerts(guestRead = true) {
  const { user, loading: authLoading, isAnonymous } = useAuth();
  const account = user && !isAnonymous ? user : null;
  const uid = account?.uid ?? null;
  const [snapshot, setSnapshot] = useState<{ uid: string | null; value: CitizenStatusResponse } | null>(null);
  const [feed, setFeed] = useState<PublicAlertFeedDocument | null>(null);
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

    let fetchFeed: ((sig?: AbortSignal) => Promise<PublicAlertFeedDocument | null>) | undefined;
    try {
      if (typeof citizenAlertsApi.readPublicAlertFeed === 'function') {
        fetchFeed = citizenAlertsApi.readPublicAlertFeed;
      }
    } catch {
      fetchFeed = undefined;
    }
    if (fetchFeed) {
      void fetchFeed(controller.signal).then(nextFeed => {
        if (!controller.signal.aborted && nextFeed) {
          setFeed(nextFeed);
        }
      });
    }

    if (authLoading || (!account && !guestRead)) {
      setReading(false);
      return () => controller.abort();
    }
    setReading(true);
    void citizenAlertsApi
      .readCitizenAlerts(account, controller.signal)
      .then(value => {
        if (!controller.signal.aborted && sequence.current === requestId && identity.current === uid) {
          setSnapshot({ uid, value });
          if (value.feed) {
            setFeed(value.feed);
          }
        }
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted && sequence.current === requestId && identity.current === uid) {
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && sequence.current === requestId) setReading(false);
      });
    return () => controller.abort();
  }, [uid, authLoading, guestRead, refreshNumber, account]);

  useEffect(() => {
    window.addEventListener('floodcast:alerts-updated', refresh);
    return () => window.removeEventListener('floodcast:alerts-updated', refresh);
  }, [refresh]);

  const change = async (action: CitizenAction, preferences?: CitizenAlertPreferences) => {
    if (!account || mutation.current?.uid === account.uid) return;
    const forUid = account.uid;
    const id = Symbol();
    mutation.current = { uid: forUid, id };
    ++sequence.current;
    setReading(false);
    setMutatingUid(forUid);
    setError(null);
    try {
      const value =
        preferences !== undefined
          ? await citizenAlertsApi.changeCitizenAlerts(account, action, preferences)
          : await citizenAlertsApi.changeCitizenAlerts(account, action);
      if (identity.current === forUid) {
        setSnapshot({ uid: forUid, value });
        return value;
      }
      return undefined;
    } catch (e) {
      if (identity.current === forUid) {
        setError(e instanceof Error ? e.message : 'Please try again.');
      }
      return undefined;
    } finally {
      if (mutation.current?.id === id) {
        mutation.current = null;
        setMutatingUid(null);
      }
    }
  };

  // A response from a previous account is never displayed after sign-out/switch.
  return {
    data: snapshot?.uid === uid ? snapshot.value : null,
    feed,
    busy: reading || (uid !== null && mutatingUid === uid),
    error,
    refresh,
    change,
    user: account,
    authLoading,
  };
}
