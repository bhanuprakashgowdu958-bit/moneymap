// Gmail Transaction Auto-Sync Service
// Automatically connects to user's Gmail to scan and import Indian bank debit emails and digital payment receipts (HDFC, ICICI, SBI, Swiggy, Zomato, Uber, Paytm, Blinkit)

import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, isFirebaseConfigured } from './firebase';
import { parseExpenseText } from './smsParser';
import { addExpense } from './firestore';

const STORAGE_KEY_TOKEN = 'moneymap_gmail_access_token';
const STORAGE_KEY_SYNCED_IDS = 'moneymap_synced_email_ids';

/**
 * Check if Gmail auto-sync is currently connected
 */
export function isGmailSyncConnected() {
  if (typeof window === 'undefined') return false;
  return Boolean(localStorage.getItem(STORAGE_KEY_TOKEN));
}

/**
 * Disconnect Gmail auto-sync
 */
export function disconnectGmailSync() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_TOKEN);
}

/**
 * Connect user's Gmail with read-only scope
 */
export async function connectGmailSync() {
  if (isFirebaseConfigured && auth) {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
      provider.setCustomParameters({ prompt: 'consent' });

      const cred = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(cred);
      const accessToken = credential?.accessToken;

      if (accessToken) {
        localStorage.setItem(STORAGE_KEY_TOKEN, accessToken);
        return { success: true, token: accessToken };
      }
    } catch (err) {
      console.warn('[MoneyMap Gmail Sync] Auth notice:', err);
      // Fallback for developer/demo test
    }
  }

  // Real Gmail connection is required — never seed fake sample emails
  return { success: false, error: 'Gmail read-only sign-in was not completed.' };
}

/**
 * Fetch and parse transactions from Gmail
 */
export async function fetchGmailTransactions() {
  const token = localStorage.getItem(STORAGE_KEY_TOKEN);
  const alreadyImportedIds = JSON.parse(localStorage.getItem(STORAGE_KEY_SYNCED_IDS) || '[]');
  const importedSet = new Set(alreadyImportedIds);

  // If real token and not demo
  if (token && token !== 'demo_gmail_access_token') {
    try {
      const q = encodeURIComponent('subject:(debited OR credited OR received OR "spent" OR "paid to" OR "transaction" OR "receipt" OR "swiggy" OR "zomato" OR "blinkit")');
      const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (listRes.ok) {
        const listData = await listRes.json();
        const messages = listData.messages || [];
        const results = [];

        for (const m of messages) {
          if (importedSet.has(m.id)) continue;

          try {
            const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!msgRes.ok) continue;
            const msgData = await msgRes.json();

            // Extract subject and from
            const headers = msgData.payload?.headers || [];
            const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || 'Transaction Alert';
            const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value || 'Bank / Merchant';
            const snippet = msgData.snippet || '';

            // Parse text
            const fullText = `${subject} ${snippet}`;
            const parsed = parseExpenseText(fullText);

            if (parsed && parsed.amount && parsed.amount > 0) {
              results.push({
                emailId: m.id,
                subject,
                from,
                date: new Date(Number(msgData.internalDate) || Date.now()).toISOString(),
                type: parsed.type === 'income' ? 'income' : 'expense',
                amount: parsed.amount,
                title: parsed.title && parsed.title !== 'Expense' ? parsed.title : subject.replace(/^(?:alert:?|transaction:?)\s*/i, '').slice(0, 35),
                counterparty: parsed.counterparty || '',
                accountHint: parsed.accountHint || '',
                category: parsed.category || 'other',
                paymentMethod: parsed.paymentMethod || 'upi',
                rawSnippet: snippet,
                source: 'gmail',
              });
            }
          } catch (e) {
            console.warn('[Gmail Sync] Message parse error:', e);
          }
        }

        return results;
      }
    } catch (err) {
      console.warn('[Gmail Sync] API access warning:', err);
    }
  }

  return [];
}

/**
 * Import chosen transactions directly into user's expenses
 */
export async function importGmailTransactions(transactions, userId) {
  if (!transactions || transactions.length === 0 || !userId) return 0;

  const alreadyImportedIds = JSON.parse(localStorage.getItem(STORAGE_KEY_SYNCED_IDS) || '[]');
  const importedSet = new Set(alreadyImportedIds);
  let count = 0;

  for (const t of transactions) {
    if (importedSet.has(t.emailId)) continue;

    try {
      await addExpense(userId, {
        type: t.type === 'income' ? 'income' : 'expense',
        title: t.title,
        counterparty: t.counterparty || '',
        accountHint: t.accountHint || '',
        amount: Number(t.amount),
        category: t.category,
        date: t.date || new Date().toISOString(),
        paymentMethod: t.paymentMethod || 'upi',
        note: `⚡ Auto-detected from Gmail (${t.from || 'Bank Alert'})`,
        isRecurring: false,
        source: 'gmail',
      });

      importedSet.add(t.emailId);
      count++;
    } catch (err) {
      console.error('[Gmail Sync] Failed to import transaction:', err);
    }
  }

  localStorage.setItem(STORAGE_KEY_SYNCED_IDS, JSON.stringify(Array.from(importedSet)));
  return count;
}
