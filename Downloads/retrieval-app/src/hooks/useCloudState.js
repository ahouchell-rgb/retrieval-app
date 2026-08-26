"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "../lib/supabase";

const draftStorageKey = (userId, draftKey) => `retrieval.draft.v2.${userId}.${draftKey}`;
const readLocalDraft = (userId, draftKey) => {
  if (typeof window === "undefined" || !userId || !draftKey) return null;
  try {
    const raw = window.localStorage.getItem(draftStorageKey(userId, draftKey));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.value === "string") return parsed;
    }
    // Read the original unversioned key once so existing pupil work is retained.
    const legacy = window.localStorage.getItem(draftKey);
    return legacy === null ? null : { value: legacy, updatedAt: 0 };
  } catch { return null; }
};

const writeLocalDraft = (userId, draftKey, value, updatedAt) => {
  if (typeof window === "undefined" || !userId || !draftKey) return;
  try {
    const key = draftStorageKey(userId, draftKey);
    if (value) window.localStorage.setItem(key, JSON.stringify({ value, updatedAt }));
    else window.localStorage.removeItem(key);
    window.localStorage.removeItem(draftKey);
  } catch { /* local continuity is best effort in private browsing */ }
};

export function useCloudDraft({ userId, draftKey, value, onRestore, disabled = false, debounceMs = 700 }) {
  const [status, setStatus] = useState("idle");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [readyKey, setReadyKey] = useState(null);
  const restoreRef = useRef(onRestore);
  const cloudAvailable = useRef(true);
  const generation = useRef(0);
  restoreRef.current = onRestore;

  useEffect(() => {
    const run = ++generation.current;
    setReadyKey(null);
    if (!userId || !draftKey || disabled) { setStatus("idle"); return undefined; }
    const local = readLocalDraft(userId, draftKey);
    if (local?.value) restoreRef.current(local.value);
    setStatus(local?.value ? "saved" : "idle");

    (async () => {
      if (cloudAvailable.current) {
        try {
          const rows = await sb.q("student_drafts", { params: {
            user_id: `eq.${userId}`, draft_key: `eq.${draftKey}`,
            select: "answer_text,updated_at", limit: "1",
          }});
          const cloud = rows?.[0];
          const cloudTime = cloud?.updated_at ? new Date(cloud.updated_at).getTime() : 0;
          if (run === generation.current && cloud?.answer_text && cloudTime > (local?.updatedAt || 0)) {
            restoreRef.current(cloud.answer_text);
            writeLocalDraft(userId, draftKey, cloud.answer_text, cloudTime);
            setLastSavedAt(cloudTime);
          }
        } catch { cloudAvailable.current = false; }
      }
      if (run === generation.current) setReadyKey(draftKey);
    })();
    return () => { generation.current += 1; };
  }, [userId, draftKey, disabled]);

  useEffect(() => {
    if (!userId || !draftKey || disabled || readyKey !== draftKey) return undefined;
    const updatedAt = Date.now();
    writeLocalDraft(userId, draftKey, value, updatedAt);
    setStatus(value ? "saving" : "idle");
    const timer = window.setTimeout(async () => {
      if (!cloudAvailable.current) { setStatus(value ? "offline" : "idle"); return; }
      try {
        if (value) {
          await sb.q("student_drafts", {
            method: "POST",
            params: { on_conflict: "user_id,draft_key" },
            prefer: "resolution=merge-duplicates,return=representation",
            body: { user_id: userId, draft_key: draftKey, answer_text: value, updated_at: new Date(updatedAt).toISOString() },
          });
          setStatus("saved"); setLastSavedAt(updatedAt);
        } else {
          await sb.del("student_drafts", { user_id: `eq.${userId}`, draft_key: `eq.${draftKey}` });
          setStatus("idle"); setLastSavedAt(null);
        }
      } catch { cloudAvailable.current = false; setStatus(value ? "offline" : "idle"); }
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [userId, draftKey, value, disabled, debounceMs, readyKey]);

  const clearDraft = useCallback(() => {
    if (!userId || !draftKey) return;
    writeLocalDraft(userId, draftKey, "", Date.now());
    setStatus("idle"); setLastSavedAt(null);
    if (cloudAvailable.current) sb.del("student_drafts", { user_id: `eq.${userId}`, draft_key: `eq.${draftKey}` }).catch(() => { cloudAvailable.current = false; });
  }, [userId, draftKey]);

  return { status, lastSavedAt, clearDraft };
}

export function useNotificationReads(userId) {
  const localKey = `retrieval.notificationReads.${userId}`;
  const [readIds, setReadIds] = useState(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(window.localStorage.getItem(localKey) || "[]")); } catch { return new Set(); }
  });
  const cloudAvailable = useRef(true);

  useEffect(() => {
    let alive = true;
    if (!userId) return undefined;
    sb.q("user_notification_reads", { params: { user_id: `eq.${userId}`, select: "notification_key" } })
      .then(rows => {
        if (!alive) return;
        setReadIds(previous => {
          const next = new Set(previous);
          (rows || []).forEach(row => next.add(row.notification_key));
          try { window.localStorage.setItem(localKey, JSON.stringify([...next])); } catch {}
          return next;
        });
      })
      .catch(() => { cloudAvailable.current = false; });
    return () => { alive = false; };
  }, [userId, localKey]);

  const markRead = useCallback((id) => {
    if (!id || !userId) return;
    setReadIds(previous => {
      const next = new Set(previous); next.add(id);
      try { window.localStorage.setItem(localKey, JSON.stringify([...next])); } catch {}
      return next;
    });
    if (cloudAvailable.current) {
      sb.q("user_notification_reads", {
        method: "POST", params: { on_conflict: "user_id,notification_key" },
        prefer: "resolution=merge-duplicates,return=representation",
        body: { user_id: userId, notification_key: id, read_at: new Date().toISOString() },
      }).catch(() => { cloudAvailable.current = false; });
    }
  }, [userId, localKey]);

  const markManyRead = useCallback((ids) => ids.forEach(markRead), [markRead]);
  return { readIds, markRead, markManyRead };
}
