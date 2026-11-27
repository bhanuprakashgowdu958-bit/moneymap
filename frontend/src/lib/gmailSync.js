// Gmail Bank & UPI Email Auto-Sync Service
// Read-only fallback channel (Safe under Play Protect & NPCI — no READ_SMS or AccessibilityService).
// Fetches recent bank debit/credit alert emails and routes them through /api/webhook so
// OTP filtering, Self-Transfer detection, and 3-minute cross-source deduplication stay consistent.

import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, isFirebaseConfigured } from './firebase';
import { parseExpenseText } from './smsParser';
import { addExpense, getOrCreateWebhookToken, isDemoUser } from './firestore';
import { isNativeAndroid, LIVE_API_ORIGIN } from './nativeBridge';
import { nativeGoogleGmailAuth } from './googleAuthNative';

const STORAGE_KEY_TOKEN = 'moneymap_gmail_access_token';
const STORAGE_KEY_META = 'moneymap_gmail_sync_meta';
const STORAGE_KEY_SYNCED_IDS = 'moneymap_synced_email_ids';

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTO_SYNC_COOLDOWN_MS = 60_000;
const MAX_CACHED_EMAIL_IDS = 500;
const GMAIL_QUERY =
  'newer_than:14d -category:promotions -category:social (debited OR credited OR "a/c" OR "account" OR "upi" OR "transaction" OR "paid to" OR "received from" OR "spent on" OR "card ending")';

const EMAIL_NOISE_RE =
  /\b(?:is\s+your\s+otp|otp\s+(?:is|for)|one\s*time\s*password|verification\s*code|pre-?approved\s+loan|apply\s+now|has\s+requested\s+(?:rs|inr|₹)|collect\s+request|transaction\s+failed|payment\s+failed|declined|unsuccessful)\b/i;

let lastAutoSyncAttemptAt = 0;
let inFlightSyncPromise = null;

function readMeta() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_META) || '{}') || {};
  } catch {
    return {};
  }
}

function writeMeta(patch) {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readMeta(), ...patch };
    localStorage.setItem(STORAGE_KEY_META, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

function readSyncedSet() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_SYNCED_IDS) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function writeSyncedSet(syncedSet) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = Array.from(syncedSet).slice(-MAX_CACHED_EMAIL_IDS);
    localStorage.setItem(STORAGE_KEY_SYNCED_IDS, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota errors
  }
}

function decodeBase64Url(data) {
  if (!data || typeof atob !== 'function') return '';
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function findPartBody(payload, mimeType) {
  if (!payload) return '';
  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const found = findPartBody(part, mimeType);
      if (found) return found;
    }
  }
  return '';
}

export function extractEmailAlertText(msgData) {
  const headers = msgData?.payload?.headers || [];
  const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
  const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
  const snippet = msgData?.snippet || '';

  let bodyText = findPartBody(msgData?.payload, 'text/plain');
  if (!bodyText) {
    const html = findPartBody(msgData?.payload, 'text/html');
    if (html) {
      bodyText = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    }
  }

  const normalizedBody = String(bodyText || snippet).replace(/\s+/g, ' ').trim().slice(0, 800);
  const combinedText = `${subject} ${normalizedBody || snippet}`.replace(/\s+/g, ' ').trim();
  return { subject, from, snippet: normalizedBody || snippet, combinedText };
}

export function isGmailSyncConnected() {
  if (typeof window === 'undefined') return false;
  return Boolean(localStorage.getItem(STORAGE_KEY_TOKEN));
}

export function getGmailSyncState() {
  const meta = readMeta();
  const hasToken = isGmailSyncConnected();
  return {
    connected: hasToken,
    email: meta.email || '',
    lastSyncAt: meta.lastSyncAt || 0,
    lastSyncedCount: Number(meta.lastSyncedCount || 0),
    needsReconnect: Boolean(meta.needsReconnect) || (!hasToken && Boolean(meta.email)),
  };
}

export function disconnectGmailSync() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_META);
}

/**
 * Connect user's Gmail with read-only scope on either Android native or Web.
 */
export async function connectGmailSync() {
  try {
    if (isNativeAndroid()) {
      const { accessToken, email } = await nativeGoogleGmailAuth();
      localStorage.setItem(STORAGE_KEY_TOKEN, accessToken);
      writeMeta({
        email: email || readMeta().email || 'Connected Gmail',
        connectedAt: Date.now(),
        needsReconnect: false,
      });
      return { success: true, token: accessToken, email };
    }

    if (isFirebaseConfigured && auth) {
      const provider = new GoogleAuthProvider();
      provider.addScope(GMAIL_READONLY_SCOPE);
      provider.setCustomParameters({ prompt: 'consent' });

      const cred = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(cred);
      const accessToken = credential?.accessToken;
      const email = cred?.user?.email || '';

      if (accessToken) {
        localStorage.setItem(STORAGE_KEY_TOKEN, accessToken);
        writeMeta({
          email: email || readMeta().email || 'Connected Gmail',
          connectedAt: Date.now(),
          needsReconnect: false,
        });
        return { success: true, token: accessToken, email };
      }
    }
  } catch (err) {
    console.warn('[MoneyMap Gmail Sync] Auth notice:', err);
    return { success: false, error: err?.message || 'Gmail authorization was not completed.' };
  }

  return { success: false, error: 'Gmail read-only sign-in was not completed.' };
}

/**
 * Fetch and parse candidate transactions from Gmail without writing to Firestore.
 */
export async function fetchGmailTransactions() {
  const token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_TOKEN) : '';
  if (!token || token === 'demo_gmail_access_token') {
    return { items: [], unauthorized: false, scannedIds: [] };
  }

  const importedSet = readSyncedSet();
  const q = encodeURIComponent(GMAIL_QUERY);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=15`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (listRes.status === 401 || listRes.status === 403) {
    return { items: [], unauthorized: true, scannedIds: [] };
  }
  if (!listRes.ok) {
    return { items: [], unauthorized: false, scannedIds: [] };
  }

  const listData = await listRes.json();
  const messages = listData.messages || [];
  const items = [];
  const scannedIds = [];

  for (const m of messages) {
    if (!m?.id || importedSet.has(m.id)) continue;

    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (msgRes.status === 401) {
        return { items, unauthorized: true, scannedIds };
      }
      if (!msgRes.ok) continue;

      const msgData = await msgRes.json();
      const { subject, from, snippet, combinedText } = extractEmailAlertText(msgData);
      scannedIds.push(m.id);

      if (!combinedText || EMAIL_NOISE_RE.test(combinedText)) continue;

      const parsed = parseExpenseText(combinedText);
      if (!parsed || !parsed.amount || Number(parsed.amount) <= 0 || !parsed.isBankSms) {
        continue;
      }

      const occurredAtMs = Number(msgData.internalDate) || Date.now();
      items.push({
        emailId: m.id,
        subject: subject || 'Transaction Alert',
        from: from || 'Bank Alert',
        snippet,
        combinedText,
        occurredAt: occurredAtMs,
        date: new Date(occurredAtMs).toISOString(),
        type: parsed.type === 'income' ? 'income' : 'expense',
        amount: Number(parsed.amount),
        title: parsed.title && parsed.title !== 'Expense'
          ? parsed.title
          : (subject || 'Bank Alert').replace(/^(?:alert:?|transaction:?)\s*/i, '').slice(0, 40),
        counterparty: parsed.counterparty || '',
        accountHint: parsed.accountHint || '',
        category: parsed.category || 'other',
        paymentMethod: parsed.paymentMethod || 'upi',
        source: 'gmail',
      });
    } catch (e) {
      console.warn('[Gmail Sync] Message parse error:', e);
    }
  }

  return { items, unauthorized: false, scannedIds };
}

/**
 * Send parsed Gmail transactions through /api/webhook (shared 3-minute cross-source dedupe,
 * self-transfer support & budget alerts), falling back to client Firestore if needed.
 */
export async function importGmailTransactions(transactions, userId, webhookToken = '') {
  if (!transactions || transactions.length === 0 || !userId) {
    return { savedCount: 0, deduplicatedCount: 0 };
  }

  const importedSet = readSyncedSet();
  let resolvedToken = webhookToken;
  if (!resolvedToken && !isDemoUser(userId)) {
    try {
      resolvedToken = await getOrCreateWebhookToken(userId);
    } catch {
      resolvedToken = '';
    }
  }

  let savedCount = 0;
  let deduplicatedCount = 0;

  for (const t of transactions) {
    if (importedSet.has(t.emailId)) continue;

    try {
      if (resolvedToken && t.combinedText) {
        const res = await fetch(
          `${LIVE_API_ORIGIN}/api/webhook?token=${encodeURIComponent(resolvedToken)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: t.combinedText,
              notificationTitle: t.subject,
              notificationText: t.snippet,
              sourcePackage: 'gmail',
              occurredAt: t.occurredAt || Date.now(),
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          if (data.deduplicated) {
            deduplicatedCount++;
          } else if (!data.ignored && Number(data.legsSaved ?? 1) > 0) {
            savedCount += Number(data.legsSaved ?? 1);
          }
          importedSet.add(t.emailId);
          continue;
        }
        if (res.status >= 400 && res.status < 500) {
          // Non-retryable parse/filter response from webhook: mark processed so we don't loop
          importedSet.add(t.emailId);
          continue;
        }
      }

      // Offline / no-token fallback
      await addExpense(userId, {
        type: t.type === 'income' ? 'income' : 'expense',
        title: t.title,
        counterparty: t.counterparty || '',
        accountHint: t.accountHint || '',
        amount: Number(t.amount),
        category: t.category,
        date: t.date || new Date().toISOString(),
        paymentMethod: t.paymentMethod || 'upi',
        note: `📧 Auto-detected from Bank Email (${t.from || 'Gmail Alert'})`,
        isRecurring: false,
        source: 'gmail',
      });
      importedSet.add(t.emailId);
      savedCount++;
    } catch (err) {
      console.error('[Gmail Sync] Failed to import email transaction:', err);
    }
  }

  writeSyncedSet(importedSet);
  return { savedCount, deduplicatedCount };
}

/**
 * Sync bank alert emails now. When allowInteractiveRefresh is true and the OAuth
 * access token expired, prompts once to refresh Gmail authorization.
 */
export async function syncGmailTransactionsNow({
  userId,
  webhookToken = '',
  allowInteractiveRefresh = false,
} = {}) {
  if (!userId || isDemoUser(userId)) {
    return { syncedCount: 0, deduplicatedCount: 0, scannedCount: 0, needsReconnect: false };
  }

  if (inFlightSyncPromise) {
    return inFlightSyncPromise;
  }

  const run = async () => {
    let token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_TOKEN) : '';
    if (!token) {
      if (!allowInteractiveRefresh) {
        return { syncedCount: 0, deduplicatedCount: 0, scannedCount: 0, needsReconnect: Boolean(readMeta().email) };
      }
      const authRes = await connectGmailSync();
      if (!authRes.success) {
        return { syncedCount: 0, deduplicatedCount: 0, scannedCount: 0, needsReconnect: true, error: authRes.error };
      }
      token = authRes.token;
    }

    let fetched = await fetchGmailTransactions();
    if (fetched.unauthorized && allowInteractiveRefresh) {
      const authRes = await connectGmailSync();
      if (authRes.success) {
        fetched = await fetchGmailTransactions();
      }
    }

    if (fetched.unauthorized) {
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      writeMeta({ needsReconnect: true });
      return { syncedCount: 0, deduplicatedCount: 0, scannedCount: 0, needsReconnect: true };
    }

    const { savedCount, deduplicatedCount } = await importGmailTransactions(
      fetched.items,
      userId,
      webhookToken
    );

    if (fetched.scannedIds.length > 0) {
      const syncedSet = readSyncedSet();
      for (const id of fetched.scannedIds) syncedSet.add(id);
      writeSyncedSet(syncedSet);
    }

    writeMeta({
      lastSyncAt: Date.now(),
      lastSyncedCount: savedCount,
      needsReconnect: false,
    });

    return {
      syncedCount: savedCount,
      deduplicatedCount,
      scannedCount: fetched.scannedIds.length,
      needsReconnect: false,
    };
  };

  inFlightSyncPromise = run().finally(() => {
    inFlightSyncPromise = null;
  });
  return inFlightSyncPromise;
}

/**
 * Throttled background sync triggered on app open/resume when Gmail sync is connected.
 */
export async function autoSyncGmailIfConnected(userId, webhookToken = '') {
  if (!userId || isDemoUser(userId) || !isGmailSyncConnected()) return null;
  const now = Date.now();
  if (now - lastAutoSyncAttemptAt < AUTO_SYNC_COOLDOWN_MS) return null;
  lastAutoSyncAttemptAt = now;

  try {
    return await syncGmailTransactionsNow({
      userId,
      webhookToken,
      allowInteractiveRefresh: false,
    });
  } catch {
    return null;
  }
}
