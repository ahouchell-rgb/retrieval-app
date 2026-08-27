"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "../lib/supabase";

export function ConnectivityBanner() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState(() => sb.pendingAnswers());
  const [syncing, setSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(0);
  const retryRef = useRef(0);
  const syncedTimerRef = useRef(null);

  const sync = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    setSyncing(true);
    try {
      const result = await sb.flushAnswers();
      setPending(result?.remaining ?? sb.pendingAnswers());
      if (result?.synced) {
        retryRef.current = 0;
        setJustSynced(result.synced);
        window.clearTimeout(syncedTimerRef.current);
        syncedTimerRef.current = window.setTimeout(() => setJustSynced(0), 3500);
      }
      return result;
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const onOnline = () => { setOnline(true); setPending(sb.pendingAnswers()); };
    const onOffline = () => setOnline(false);
    const onQueue = event => setPending(event.detail?.count ?? sb.pendingAnswers());
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("retrieval:pending-answers", onQueue);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("retrieval:pending-answers", onQueue);
      window.clearTimeout(syncedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!online || pending < 1) return undefined;
    let cancelled = false;
    let timer;
    const attempt = async () => {
      const result = await sync();
      if (cancelled || !result?.remaining) return;
      retryRef.current += 1;
      const delay = Math.min(300000, 5000 * (2 ** Math.min(retryRef.current, 6)));
      timer = window.setTimeout(attempt, delay);
    };
    timer = window.setTimeout(attempt, retryRef.current ? 5000 : 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [online, pending, sync]);

  if (online && pending === 0 && !justSynced) return null;
  return (
    <div className={`connectivity-banner ${online ? "syncing" : "offline"}`} role="status" aria-live="polite">
      <span className="connectivity-dot" aria-hidden="true" />
      <span>{!online ? `Offline${pending ? ` · ${pending} answer${pending === 1 ? "" : "s"} safely queued` : " · work will be kept on this device"}` : justSynced ? `${justSynced} queued answer${justSynced === 1 ? "" : "s"} synced` : `${pending} answer${pending === 1 ? "" : "s"} waiting to sync`}</span>
      {online && pending > 0 ? <button onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</button> : null}
    </div>
  );
}
