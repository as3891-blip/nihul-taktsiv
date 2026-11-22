import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://iqatwsviyjuxbbqcemms.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_wkXb7XKvN-IzTtYWXvkZPw_zzdvNn4H";
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export type Lang = "he" | "en";
export type TxType = "income" | "expense";
export type Tx = { id: string; type: TxType; amount: number; date: string; category: string; description: string };
export type Account = { id: string; phone: string; email?: string; firstName?: string; lastName?: string; createdAt: string };
export type Mode = "login" | "signup";
export type Challenge = { phone: string; mode: Mode; code: string; expiresAt: number; resendAfter: number; attemptsLeft: number };
export type Draft = { type: TxType; amount: string; date: string; category: string; description: string };
export type DraftError = "amountPositive" | "amountDecimals" | "amountTooLarge" | "dateInvalid" | "categoryInvalid" | "descriptionTooLong";

export const CATEGORY_IDS = ["salary", "food", "housing", "transport", "health", "entertainment", "other"] as const;
export const CODE_TTL_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
export const RESEND_MS = 30_000;
const LOCALE: Record<Lang, string> = { he: "he-IL", en: "en-IL" };
const DIR: Record<Lang, "rtl" | "ltr"> = { he: "rtl", en: "ltr" };
const OPERATOR = {
  he: { name: "איילת שפיבק", type: "עוסק פטור / פרויקט אישי", city: "בית שמש, ישראל" },
  en: { name: "Ayelet Shpivak", type: "Exempt dealer / personal project", city: "Beit Shemesh, Israel" },
  email: "as3891@mkp.org.il",
  updated: "2026-11-18",
};

export const ADMIN_EMAILS: readonly string[] = ["as3891@mkp.org.il"];
export const ADMIN_PHONES: readonly string[] = ["0536239587"];
export const isAdminPhone = (identifier: string): boolean => {
  const clean = identifier.trim().toLowerCase();
  if (ADMIN_EMAILS.includes(clean)) return true;
  const p = normalizePhone(identifier);
  return p !== null && ADMIN_PHONES.includes(p);
};
export type IdRecord = { salt: string; iterations: number; hash: string };
export const ADMIN_ID_RECORD: IdRecord = {
  salt: "LHXwKf5exNKYm6jOPkIFoA==",
  iterations: 600000,
  hash: "2mVkl55vq2pd36WoPN1xSnYoRIJEs0MEAXGrkjQDIWk=",
};

export function isValidIsraeliId(id: string): boolean {
  if (!/^\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(id[i]) * (i % 2 === 0 ? 1 : 2);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

export function normalizeIsraeliId(input: string): string | null {
  const s = input.trim().replace(/[\s-]/g, "");
  if (!/^\d{5,9}$/.test(s)) return null;
  const padded = s.padStart(9, "0");
  return isValidIsraeliId(padded) ? padded : null;
}

export async function hashId(id: string, saltB64: string, iterations: number): Promise<string> {
  const base = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(id), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const bits = await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function verifyAdminId(input: string, record: IdRecord = ADMIN_ID_RECORD): Promise<"ok" | "wrong" | "format"> {
  const id = normalizeIsraeliId(input);
  if (!id) return "format";
  const got = await hashId(id, record.salt, record.iterations);
  let diff = got.length ^ record.hash.length;
  for (let i = 0; i < Math.min(got.length, record.hash.length); i++) diff |= got.charCodeAt(i) ^ record.hash.charCodeAt(i);
  return diff === 0 ? "ok" : "wrong";
}

export const KEYS = {
  lang: "app:lang",
  accounts: "budget:accounts",
  data: "budget:data:",
  session: "session:account",
  adminSession: "session:admin",
} as const;

export function normalizePhone(input: string): string | null {
  let s = input.trim().replace(/[\s\-.()]/g, "");
  if (!/^\+?\d+$/.test(s)) return null;
  if (s.startsWith("+972")) s = "0" + s.slice(4);
  else if (s.startsWith("00972")) s = "0" + s.slice(5);
  else if (s.startsWith("972") && s.length >= 11) s = "0" + s.slice(3);
  else if (s.startsWith("+")) s = s.slice(1);
  return /^\d{9,15}$/.test(s) ? s : null;
}

export const maskPhone = (p: string): string => (p.length <= 7 ? p : p.slice(0, 3) + "•••" + p.slice(-4));

export function generateCode(): string {
  const limit = 4294967296 - (4294967296 % 9000);
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(1000 + (buf[0] % 9000));
}

export const createChallenge = (phone: string, mode: Mode, now: number, code: string = generateCode()): Challenge => ({
  phone,
  mode,
  code,
  expiresAt: now + CODE_TTL_MS,
  resendAfter: now + RESEND_MS,
  attemptsLeft: MAX_ATTEMPTS,
});

export function verifyCode(
  ch: Challenge,
  input: string,
  now: number
): { ok: true } | { ok: false; reason: "expired" | "wrong" | "locked"; challenge: Challenge } {
  if (now > ch.expiresAt) return { ok: false, reason: "expired", challenge: ch };
  if (ch.attemptsLeft <= 0) return { ok: false, reason: "locked", challenge: ch };
  if (input.trim() === ch.code) return { ok: true };
  const next = { ...ch, attemptsLeft: ch.attemptsLeft - 1 };
  return { ok: false, reason: next.attemptsLeft <= 0 ? "locked" : "wrong", challenge: next };
}

export function secondsUntilResend(ch: Challenge, now: number): number {
  if (now > ch.expiresAt || ch.attemptsLeft <= 0) return 0;
  return Math.max(0, Math.ceil((ch.resendAfter - now) / 1000));
}

export function isRealIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function validateDraft(d: Draft): Partial<Record<keyof Draft, DraftError>> {
  const e: Partial<Record<keyof Draft, DraftError>> = {};
  const raw = d.amount.trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) e.amount = "amountPositive";
  else if (!/^\d+(\.\d{1,2})?$/.test(raw)) e.amount = "amountDecimals";
  else if (n > 100_000_000) e.amount = "amountTooLarge";
  if (!isRealIsoDate(d.date)) e.date = "dateInvalid";
  if (!(CATEGORY_IDS as readonly string[]).includes(d.category)) e.category = "categoryInvalid";
  if (d.description.length > 100) e.description = "descriptionTooLong";
  return e;
}

export const monthOf = (date: string): string => date.slice(0, 7);

export function monthsOf(txs: Tx[], type: TxType): { month: string; count: number; total: number }[] {
  const map = new Map<string, { count: number; cents: number }>();
  for (const t of txs) {
    if (t.type !== type) continue;
    const e = map.get(monthOf(t.date)) ?? { count: 0, cents: 0 };
    e.count += 1;
    e.cents += Math.round(t.amount * 100);
    map.set(monthOf(t.date), e);
  }
  return [...map].map(([month, e]) => ({ month, count: e.count, total: e.cents / 100 })).sort((a, b) => b.month.localeCompare(a.month));
}

export const monthTxs = (txs: Tx[], type: TxType, month: string): Tx[] =>
  txs.filter((t) => t.type === type && monthOf(t.date) === month).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

export function summarize(txs: Tx[], month: string): { income: number; expense: number; net: number } {
  let i = 0;
  let x = 0;
  for (const t of txs) {
    if (monthOf(t.date) === month) {
      const c = Math.round(t.amount * 100);
      if (t.type === "income") i += c;
      else x += c;
    }
  }
  return { income: i / 100, expense: x / 100, net: (i - x) / 100 };
}

export type AdminRow = { id: string; phone: string; createdAt: string; count: number; isAdmin: boolean };

export function adminStats(accounts: Account[], txsOf: (id: string) => Tx[]): { accounts: number; active: number; transactions: number; rows: AdminRow[] } {
  const rows = accounts
    .map((a) => ({ id: a.id, phone: a.phone, createdAt: a.createdAt, count: txsOf(a.id).length, isAdmin: isAdminPhone(a.phone) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { accounts: rows.length, active: rows.filter((r) => r.count > 0).length, transactions: rows.reduce((n, r) => n + r.count, 0), rows };
}

const norm = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();

export function searchTxs(txs: Tx[], query: string, lang: Lang, catLabel: (id: string) => string): Tx[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const fmtD = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(LOCALE[lang]);
  const fmtM = (k: string) => new Intl.DateTimeFormat(LOCALE[lang], { month: "long", year: "numeric" }).format(new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1));
  return txs
    .filter((t) => {
      const hay = norm([t.description, t.category, catLabel(t.category), t.date, fmtD(t.date), fmtM(monthOf(t.date))].join(" | "));
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function isTx(v: unknown): v is Tx {
  const t = v as Record<string, unknown> | null;
  return (
    !!t &&
    typeof t === "object" &&
    typeof t.id === "string" &&
    t.id.length > 0 &&
    t.id.length <= 64 &&
    (t.type === "income" || t.type === "expense") &&
    typeof t.amount === "number" &&
    Number.isFinite(t.amount) &&
    t.amount > 0 &&
    t.amount <= 100_000_000 &&
    typeof t.date === "string" &&
    isRealIsoDate(t.date) &&
    typeof t.category === "string" &&
    t.category.length > 0 &&
    t.category.length <= 50 &&
    typeof t.description === "string" &&
    t.description.length <= 120
  );
}

const LEGACY: Record<string, string> = {
  "משכורת": "salary",
  "מזון": "food",
  "דיור": "housing",
  "תחבורה": "transport",
  "בריאות": "health",
  "בילויים": "entertainment",
  "אחר": "other",
};

export function parseBackup(text: string): { ok: true; txs: Tx[] } | { ok: false; error: "notJson" | "notBackup" | "badVersion" | "badRecords" } {
  let d: { app?: string; version?: number; transactions?: unknown[] } | null;
  try {
    d = JSON.parse(text);
  } catch {
    return { ok: false, error: "notJson" };
  }
  if (!d || d.app !== "budget" || !Array.isArray(d.transactions)) return { ok: false, error: "notBackup" };
  if (d.version !== 1) return { ok: false, error: "badVersion" };
  if (!d.transactions.every(isTx)) return { ok: false, error: "badRecords" };
  return {
    ok: true,
    txs: (d.transactions as Tx[]).map((t) => ({
      ...t,
      category: (CATEGORY_IDS as readonly string[]).includes(t.category) ? t.category : LEGACY[t.category] ?? "other",
    })),
  };
}

const uid = (): string =>
  globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const store = (kind: "localStorage" | "sessionStorage") => ({
  get: (k: string): string | null => {
    try {
      return window[kind].getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string): boolean => {
    try {
      window[kind].setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  del: (k: string): void => {
    try {
      window[kind].removeItem(k);
    } catch {
      // ignore
    }
  },
});

const ls = store("localStorage");
const ss = store("sessionStorage");

function loadAccounts(): Account[] {
  try {
    const p = JSON.parse(ls.get(KEYS.accounts) ?? "[]");
    return Array.isArray(p) ? p.filter((a) => a && typeof a.id === "string" && typeof a.phone === "string") : [];
  } catch {
    return [];
  }
}

function loadTxs(id: string): Tx[] {
  try {
    const p = JSON.parse(ls.get(KEYS.data + id) ?? "[]");
    return Array.isArray(p) && p.every(isTx) ? p : [];
  } catch {
    return [];
  }
}

function removeAccount(id: string): void {
  ls.set(KEYS.accounts, JSON.stringify(loadAccounts().filter((a) => a.id !== id)));
  ls.del(KEYS.data + id);
}

async function fetchCloudTxs(userId: string): Promise<Tx[]> {
  try {
    const { data, error } = await supabase.from("budget_states").select("state").eq("user_id", userId).maybeSingle();
    if (error || !data?.state) return [];
    const raw = (data.state as { transactions?: unknown[] })?.transactions;
    return Array.isArray(raw) && raw.every(isTx) ? raw : [];
  } catch {
    return [];
  }
}

async function pushCloudTxs(acc: Account, transactions: Tx[]): Promise<boolean> {
  try {
    const { error } = await supabase.from("budget_states").upsert(
      {
        user_id: acc.id,
        email: acc.email ?? null,
        first_name: acc.firstName ?? null,
        last_name: acc.lastName ?? null,
        phone: acc.phone !== acc.email && acc.phone !== acc.id ? acc.phone : null,
        state: { app: "budget", version: 1, transactions },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    return !error;
  } catch {
    return false;
  }
}

const he = {
  name: "ניהול תקציב אישי",
  brand: "תקציב",
  skip: "דלג לתוכן הראשי",
  langLabel: "שפה / Language",
  nav: {
    label: "תפריט ראשי",
    toc: "תוכן עניינים",
    open: "פתח תפריט",
    close: "סגור תפריט",
    overview: "ראשי",
    income: "הכנסות",
    expenses: "הוצאות",
    search: "חיפוש",
    account: "חשבון",
    legal: "פרטיות ותנאים",
    logout: "יציאה",
    admin: "ניהול מערכת",
  },
  types: { income: "הכנסה", expense: "הוצאה" },
  cats: {
    salary: "משכורת",
    food: "מזון",
    housing: "דיור",
    transport: "תחבורה",
    health: "בריאות",
    entertainment: "בילויים",
    other: "אחר",
  } as Record<string, string>,
  auth: {
    login: "כניסה",
    signup: "יצירת חשבון",
    language: "בחירת שפה",
    phone: "מספר טלפון",
    phoneHelp: "לדוגמה: 050-1234567.",
    send: "שלחו לי קוד אימות",
    sim: "כניסה באמצעות אימייל וסיסמה מול Supabase.",
    codeTitle: "הקלידו את קוד האימות",
    codeFor: (p: string) => `קוד עבור ${p}.`,
    simCode: "קוד אימות",
    code: "קוד אימות",
    codeHelp: "4 ספרות",
    verifyLogin: "אישור וכניסה",
    verifySignup: "אישור ויצירת חשבון",
    resend: "שלחו קוד חדש",
    resendIn: (s: number) => `בעוד ${s} שניות`,
    change: "שינוי",
    noAccount: "אין לך חשבון?",
    haveAccount: "כבר יש לך חשבון?",
    consent: "קראתי ואני מאשר/ת את מדיניות הפרטיות ותנאי השימוש",
    consentLink: "פרטיות ותנאים",
    device: "הנתונים מסונכרנים לענן ב-Supabase.",
    err: {
      phoneInvalid: "מספר הטלפון אינו תקין.",
      noAccount: "לא נמצא חשבון.",
      accountExists: "כבר קיים חשבון.",
      consent: "כדי להמשיך יש לאשר את מדיניות הפרטיות ותנאי השימוש.",
      tooSoon: (s: number) => `בעוד ${s} שניות.`,
      codeFormat: "יש להקליד 4 ספרות.",
      wrong: (n: number) => `הקוד שגוי. נשארו ${n} ניסיונות.`,
      locked: "הקוד ננעל.",
      expired: "תוקף הקוד פג.",
      noChallenge: "יש לבקש קוד אימות קודם.",
      storage: "לא ניתן לשמור כרגע בענן (נשמר עותק מקומי בדפדפן).",
    },
  },
  form: {
    add: "הוספת עסקה",
    edit: "עריכת עסקה",
    type: "סוג העסקה",
    amount: "סכום (₪)",
    date: "תאריך",
    category: "קטגוריה",
    pick: "בחרו קטגוריה",
    desc: "תיאור (לא חובה)",
    addBtn: "הוסף עסקה",
    saveBtn: "שמור שינויים",
    cancel: "ביטול עריכה",
    errors: (n: number) => `יש ${n} שגיאות בטופס. תקנו אותן ונסו שוב.`,
    e: {
      amountPositive: "יש להזין סכום גדול מאפס.",
      amountDecimals: "יש להזין עד שתי ספרות אחרי הנקודה העשרונית.",
      amountTooLarge: "הסכום גדול מדי.",
      dateInvalid: "יש לבחור תאריך תקין.",
      categoryInvalid: "יש לבחור קטגוריה מהרשימה.",
      descriptionTooLong: "התיאור ארוך מדי (עד 100 תווים).",
    } as Record<DraftError, string>,
  },
  list: {
    recent: "עסקאות אחרונות",
    empty: "עדיין לא נוספו עסקאות. הוסיפו את העסקה הראשונה בטופס.",
    caption: "עסקאות אחרונות, מהחדשה לישנה",
    h: { date: "תאריך", type: "סוג", category: "קטגוריה", description: "תיאור", amount: "סכום", actions: "פעולות" },
    edit: "עריכה",
    del: "מחיקה",
    none: "ללא תיאור",
    editing: "(בעריכה)",
    editAria: (d: string) => `עריכת עסקה: ${d}`,
    delAria: (d: string) => `מחיקת עסקה: ${d}`,
  },
  status: {
    added: "העסקה נוספה.",
    updated: "העסקה עודכנה.",
    deleted: "העסקה נמחקה. אפשר לבטל את המחיקה מתחת לכותרת.",
    restored: "העסקה שוחזרה.",
  },
  confirm: {
    title: "למחוק את העסקה?",
    body: (d: string) => `${d}. אי אפשר לשחזר עסקה שנמחקה, אלא מקובץ גיבוי.`,
    cancel: "ביטול",
    yes: "מחק עסקה",
  },
  undo: {
    label: "ביטול מחיקה אחרונה",
    text: (d: string) => `נמחקה העסקה: ${d}.`,
    btn: "בטל מחיקה",
    close: "סגור",
    closeAria: "סגור את הודעת ביטול המחיקה",
  },
  overview: {
    title: "ניהול תקציב אישי",
    summary: (m: string) => `סיכום ${m}`,
    income: "הכנסות",
    expense: "הוצאות",
    balance: "יתרה לחודש",
    surplus: "(עודף)",
    deficit: "(גירעון)",
  },
  section: {
    income: "הכנסות",
    expenses: "הוצאות",
    intro: "בחרו חודש כדי לראות את כל העסקאות שלו, לפי תאריך.",
    emptyIncome: "עדיין אין הכנסות. הוסיפו הכנסה במסך הראשי.",
    emptyExpenses: "עדיין אין הוצאות. הוסיפו הוצאה במסך הראשי.",
    count: (n: number) => `${n} עסקאות`,
    total: (s: string) => `סך הכול ${s}`,
    expandAll: "פתח את כל החודשים",
    collapseAll: "סגור את כל החודשים",
    caption: (ty: string, m: string) => `${ty}, ${m}, לפי תאריך`,
    headers: ["תאריך", "תיאור", "קטגוריה", "סכום"],
  },
  search: {
    label: "חיפוש עסקאות",
    placeholder: "חיפוש לפי תיאור, קטגוריה או תאריך",
    btn: "חיפוש",
    title: "תוצאות חיפוש",
    hint: "אפשר לחפש לפי תיאור, קטגוריה או תאריך, בכל החודשים.",
    prompt: "הקלידו מילה בשורת החיפוש כדי להתחיל.",
    results: (n: number, q: string) => `נמצאו ${n} תוצאות עבור "${q}"`,
    none: (q: string) => `לא נמצאו תוצאות עבור "${q}".`,
    caption: "תוצאות החיפוש, מהחדשה לישנה",
    headers: ["תאריך", "סוג", "קטגוריה", "תיאור", "סכום"],
  },
  gate: {
    title: "אימות מנהל/ת מערכת",
    intro: "הזינו מספר תעודת זהות או המשיכו כמשתמש/ת רגיל/ה.",
    label: "מספר תעודת זהות",
    help: "נבדק בדפדפן מול תקציר חד-כיווני.",
    verify: "אימות",
    checking: "בודק...",
    skip: "המשך כמשתמש/ת רגיל/ה",
    sim: "בדיקה בצד הלקוח בלבד.",
    err: {
      format: "מספר תעודת הזהות אינו תקין.",
      wrong: (n: number) => `מספר תעודת הזהות שגוי. נשארו ${n} ניסיונות.`,
    },
  },
  admin: {
    title: "ניהול מערכת",
    note: "נתוני חשבונות במכשיר זה.",
    accounts: "חשבונות במכשיר",
    active: "חשבונות עם עסקאות",
    transactions: "סך העסקאות",
    caption: "החשבונות במכשיר הזה",
    headers: ["חשבון", "נוצר", "עסקאות", "תפקיד", "פעולות"],
    roleAdmin: "מנהל/ת מערכת",
    roleUser: "משתמש/ת",
    empty: "אין חשבונות במכשיר הזה.",
    delete: "מחק חשבון",
    deleteAria: (p: string) => `מחיקת החשבון ${p}`,
    confirmTitle: (p: string) => `למחוק את החשבון ${p}?`,
    confirmBody: "החשבון יימחק מהמכשיר הזה.",
    yes: "כן, מחק את החשבון",
    no: "ביטול",
    deleted: (p: string) => `החשבון ${p} נמחק.`,
  },
  account: {
    title: "חשבון",
    role: "תפקיד",
    phone: "חשבון מחובר",
    logout: "יציאה מהחשבון",
    sim: "העסקאות שלך מסונכרנות לענן דרך Supabase.",
    dangerTitle: "מחיקת נתונים מקומיים",
    dangerBody: "המחיקה תסיר מהמכשיר הזה את הנתונים המקומיים.",
    delete: "מחק נתונים מקומיים",
    confirmTitle: "למחוק את הנתונים המקומיים?",
    confirmBody: "הפעולה סופית.",
    yes: "כן, מחק",
    no: "ביטול",
    backupTitle: "גיבוי ושחזור",
    backupIntro: "ניתן לייצא או לייבא קובץ גיבוי JSON בכל עת.",
    export: "ייצוא גיבוי לקובץ",
    import: "ייבוא מקובץ גיבוי (JSON)",
    replaceTitle: "להחליף את הנתונים הקיימים?",
    replaceBody: (a: number, b: number) => `הייבוא יחליף ${a} עסקאות ב-${b} עסקאות מהקובץ.`,
    replace: "החלף את הנתונים",
    exported: (n: number) => `הגיבוי הורד (${n} עסקאות).`,
    imported: (n: number) => `הנתונים הוחלפו וסונכרנו לענן: ${n} עסקאות.`,
    tooLarge: "הקובץ גדול מדי (עד 5MB).",
    be: {
      notJson: "הקובץ אינו JSON תקין.",
      notBackup: "הקובץ אינו גיבוי של האפליקציה.",
      badVersion: "גרסת הגיבוי אינה נתמכת.",
      badRecords: "הקובץ מכיל עסקאות פגומות.",
    },
  },
  legal: {
    title: "פרטיות, תנאים ונגישות",
    updated: (d: string) => `עודכן לאחרונה: ${d}`,
    back: "חזרה",
    contact: "יצירת קשר",
    emailPrefix: "דוא״ל:",
    sections: [
      {
        title: "פרטיות",
        paras: [
          "האפליקציה מופעלת על ידי {name} ({type}), {city}.",
          "ההתחברות מתבצעת באמצעות אימייל וסיסמה דרך Supabase, והעסקאות מסונכרנות לענן.",
        ],
      },
      {
        title: "אחסון מקומי ועוגיות",
        paras: ["האפליקציה משתמשת באחסון הדפדפן וב-Supabase לשמירת הנתונים:"],
      },
      {
        title: "תנאי שימוש",
        paras: ["האפליקציה היא כלי אישי לתיעוד הכנסות והוצאות ואינה מהווה ייעוץ פיננסי או מס."],
      },
      {
        title: "נגישות",
        paras: ["אנו שואפים לעמוד בהנחיות WCAG 2.1 ברמה AA. פנו אל {name} בדוא״ל {email}."],
      },
    ],
    keysTitle: "מפתחות האחסון",
    keyHeaders: ["מפתח", "מטרה", "משך"],
    persistent: "עד למחיקה",
    sessionOnly: "עד סגירת הלשונית",
    purposes: {
      lang: "העדפת השפה",
      accounts: "חשבונות מקומיים",
      data: "עסקאות מקומיות",
      session: "סשן נוכחי",
      adminSession: "אימות מנהל",
    },
  },
  footer: {
    disclaimer: "האפליקציה היא כלי אישי ואינה מהווה ייעוץ פיננסי, מס או חשבונאות. הנתונים מסונכרנים דרך Supabase.",
  },
};

type Dict = typeof he;
const en: Dict = {
  ...he,
  name: "Personal Budget",
  brand: "Budget",
  skip: "Skip to main content",
  nav: { ...he.nav, label: "Main menu", toc: "Table of contents", overview: "Overview", income: "Income", expenses: "Expenses", search: "Search", account: "Account", legal: "Privacy and terms", logout: "Sign out", admin: "Administration" },
  types: { income: "Income", expense: "Expense" },
  cats: { salary: "Salary", food: "Food", housing: "Housing", transport: "Transport", health: "Health", entertainment: "Entertainment", other: "Other" },
  auth: { ...he.auth, login: "Sign in", signup: "Create an account", language: "Choose language", noAccount: "Don't have an account?", haveAccount: "Already have an account?", consent: "I accept the Privacy Policy and Terms of Use", consentLink: "Privacy and terms" },
  form: { ...he.form, add: "Add a transaction", edit: "Edit transaction", type: "Transaction type", amount: "Amount", date: "Date", category: "Category", pick: "Choose a category", desc: "Description (optional)", addBtn: "Add transaction", saveBtn: "Save changes", cancel: "Cancel editing" },
  overview: { ...he.overview, title: "Personal Budget", summary: (m: string) => `Summary: ${m}`, income: "Income", expense: "Expenses", balance: "Monthly balance", surplus: "(surplus)", deficit: "(deficit)" },
  section: { ...he.section, income: "Income", expenses: "Expenses", count: (n: number) => `${n} transactions`, total: (s: string) => `Total ${s}`, expandAll: "Expand all months", collapseAll: "Collapse all months", caption: (ty: string, m: string) => `${ty}, ${m}`, headers: ["Date", "Description", "Category", "Amount"] },
  search: { ...he.search, label: "Search transactions", placeholder: "Search...", btn: "Search", title: "Search results", caption: "Search results", headers: ["Date", "Type", "Category", "Description", "Amount"] },
  account: { ...he.account, title: "Account", role: "Role", phone: "Signed-in account", logout: "Sign out", export: "Export backup", import: "Import backup (JSON)", replace: "Replace data", no: "Cancel" },
  footer: { disclaimer: "Personal tool only. Data is synced via Supabase." },
};

export const DICT: Record<Lang, Dict> = { he, en };

const CSS = `
:root{--bg:#F8F6F3;--card:#FFFDF9;--ink:#3D3631;--ink2:#5C534B;--bronze:#B79A6A;--bronze-d:#8C6F3E;--sage:#8A8F84;--sage-t:#E6E8E1;--terra:#C79E87;--terra-t:#F6E9E2;
--olive:#4F5548;--olive-d:#3F4538;--focus:#5E6554;--danger:#8F4A33;--danger-d:#7A3F2B;--field:#6F655C;--head:#F0EBE2;--line:#D4C3A3;--ok:#3F4D38;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Heebo","Assistant","Segoe UI",system-ui,"Arial Hebrew",Arial,sans-serif;font-weight:350;line-height:1.7}
h1,h2,h3{font-family:"Frank Ruhl Libre","David Libre","Times New Roman",Georgia,serif;font-weight:500;letter-spacing:.01em;margin:0 0 .5rem;line-height:1.3}
h1{font-size:1.9rem}h2{font-size:1.4rem}h3{font-size:1.15rem}
a{color:var(--olive-d)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.skip{position:absolute;inset-inline-start:.5rem;top:-4rem;background:var(--olive);color:#fff;padding:.5rem 1rem;border-radius:.75rem;z-index:50}.skip:focus{top:.5rem}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.app{display:block}@media(min-width:768px){.app{display:flex}}
.side{background:var(--card);border-bottom:1px solid var(--bronze);padding:.75rem}
@media(min-width:768px){.side{min-height:100vh;border-bottom:0;border-inline-end:1px solid var(--bronze);width:16rem;flex:none}.side.closed{width:4.5rem}}
.side-top{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.brand{display:flex;align-items:center;gap:.5rem;color:var(--bronze-d);font-family:"Frank Ruhl Libre",Georgia,serif;font-size:1.25rem}.brand span{color:var(--ink)}
.side.closed .brand span,.side.closed .toc-title{display:none}
.toc-title{margin:1rem 0 .25rem;color:var(--ink2);font-size:.9rem}
.side ul{list-style:none;margin:0;padding:0}.side li{margin:.15rem 0}
.link{display:flex;align-items:center;gap:.75rem;padding:.5rem .75rem;border-radius:.75rem;border-inline-start:4px solid transparent;color:var(--ink);text-decoration:none;background:none;border-top:0;border-bottom:0;border-inline-end:0;width:100%;font:inherit;cursor:pointer;text-align:start}
.link:hover{background:#F4F1EC}.link[aria-current=page]{background:var(--sage-t);border-inline-start-color:var(--bronze);font-weight:500}
.link svg{color:var(--bronze-d);flex:none}
.side.closed .link span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.side.closed .toc{display:none}@media(min-width:768px){.side.closed .toc{display:block}.side.closed .toc .keep{display:none}}
.toc.hide{display:none}@media(min-width:768px){.toc.hide{display:block}}
.content{flex:1;min-width:0}
.topbar{border-bottom:1px solid var(--line);padding:.75rem 1rem}
main{display:block;max-width:46rem;margin:0 auto;padding:1.5rem 1rem}main.wide{max-width:52rem}
.btn{display:inline-flex;align-items:center;gap:.5rem;border-radius:.75rem;border:1px solid var(--field);background:#fff;color:var(--ink);padding:.5rem 1rem;font:inherit;font-weight:500;cursor:pointer}
.btn.primary{background:var(--olive);border-color:var(--olive);color:#fff}.btn.danger{background:var(--danger);border-color:var(--danger);color:#fff}
.btn.ghost{border-color:var(--danger);color:var(--danger-d)}.btn.link-btn{border:0;background:none;color:var(--olive-d);text-decoration:underline;padding:.5rem 0}
.btn:disabled{opacity:.6;cursor:not-allowed}.row{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center}
.field{display:block;margin-top:.25rem;width:100%;border-radius:.75rem;border:1px solid var(--field);background:var(--card);color:var(--ink);padding:.5rem .75rem;font:inherit}
.field.ltr{direction:ltr}label,legend{font-weight:500}.help{color:var(--ink2);font-size:.9rem;margin:.25rem 0 0}
.stack>*+*{margin-top:1rem}.err{color:var(--danger-d);font-weight:500;margin:.25rem 0 0}.ok{color:var(--ok);font-weight:500}
.arch{background:var(--card);border:1px solid var(--bronze);border-radius:50% 50% 1.25rem 1.25rem/2.5rem 2.5rem 1.25rem 1.25rem}
.box{background:var(--card);border:1px solid var(--bronze);border-radius:1.25rem}
.note{border:1px solid var(--bronze);background:var(--terra-t);border-radius:.75rem;padding:.75rem}
.alert-box{border:2px solid var(--danger);background:var(--terra-t);border-radius:.75rem;padding:1rem}.info-box{border:2px solid var(--olive-d);background:#EEF0E9;border-radius:.75rem;padding:.75rem}
.cards{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));margin:0}
.cards>div{padding:2rem 1rem 1rem;text-align:center}.cards dt{color:var(--ink2)}.cards dd{margin:0;font-size:1.3rem;font-weight:700}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}caption{text-align:start;font-weight:500;margin-bottom:.25rem}
th,td{border:1px solid var(--line);padding:.5rem;text-align:start}thead th{background:var(--head)}tbody th{font-weight:350}
.acc-btn{display:flex;width:100%;align-items:center;justify-content:space-between;gap:.75rem;border:0;background:none;font:inherit;color:inherit;text-align:start;padding:1rem;border-radius:1.25rem;cursor:pointer}
.acc-btn .t{font-family:"Frank Ruhl Libre",Georgia,serif;font-size:1.2rem}.acc-btn .m{flex:1;color:var(--ink2);font-size:.9rem}
.acc-body{border-top:1px solid var(--line);padding:1rem}.chev{transition:transform .15s}.chev.open{transform:rotate(180deg)}
footer{border-top:1px solid var(--bronze);background:var(--head);padding:1.5rem 1rem;margin-top:3rem;font-size:.95rem}
header.pub{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--bronze);padding:.75rem 1rem}
.badge{display:inline-block;border:1px solid var(--sage);background:var(--sage-t);border-radius:999px;padding:.05rem .75rem;font-size:.9rem}.badge.admin{border-color:var(--terra);background:var(--terra-t)}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;

type Ctx = {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: Dict;
  setLang: (l: Lang) => void;
  nis: (n: number) => string;
  month: (k: string) => string;
  date: (iso: string) => string;
  cat: (id: string) => string;
  account: Account | null;
  isAdmin: boolean;
  txs: Tx[];
  setTxs: (next: Tx[]) => void;
  saveFailed: boolean;
  challenge: Challenge | null;
  requestCode: (phone: string, mode: Mode) => string | null;
  verify: (code: string) => string | null;
  cancelChallenge: () => void;
  logout: () => void;
  deleteAccount: () => void;
  completeAdminGate: (ok: boolean) => void;
  path: string;
  query: URLSearchParams;
  go: (to: string) => void;
};

const AppCtx = createContext<Ctx | null>(null);
function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside <BudgetApp>");
  return c;
}

const ICONS: Record<string, string> = {
  menu: "M4 7h16M4 12h16M4 17h16",
  home: "M4 11 12 4l8 7v9H4zM10 20v-5h4v5",
  income: "M12 4v11m0 0-4-4m4 4 4-4M5 20h14",
  expenses: "M12 15V4m0 0-4 4m4-4 4 4M5 20h14",
  search: "M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM20 20l-4.5-4.5",
  account: "M15.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM5 20c0-3.9 3.1-7 7-7s7 3.1 7 7",
  legal: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6",
  admin: "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z",
  logout: "M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M14 8l4 4-4 4M18 12H9",
  chevron: "m6 9 6 6 6-6",
};

function Icon({ name, size = 22, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

function LangSelect({ label }: { label?: string }) {
  const { lang, setLang, t } = useApp();
  return (
    <div>
      <label htmlFor="lang-select">{label ?? t.langLabel}</label>
      <select id="lang-select" className="field" value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "he")}>
        <option value="he" lang="he">עברית</option>
        <option value="en" lang="en">English</option>
      </select>
    </div>
  );
}

function DataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="scroll" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>{headers.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

const monthKeyNow = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const describe = (c: Ctx, tx: Tx): string => `${c.t.types[tx.type]}, ${c.cat(tx.category)}, ${c.nis(tx.amount)}, ${c.date(tx.date)}`;

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function AuthView({ mode }: { mode: Mode }) {
  const c = useApp();
  const { t, account, go } = c;
  useEffect(() => {
    if (account) go("/");
  }, [account]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    const cleanEmail = email.trim();
    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    const cleanPhone = phone.trim() ? normalizePhone(phone) : null;

    if (mode === "signup") {
      if (!cleanFirst) return setError(c.lang === "he" ? "יש להזין שם פרטי." : "Enter your first name.");
      if (!cleanLast) return setError(c.lang === "he" ? "יש להזין שם משפחה." : "Enter your last name.");
      if (!cleanPhone) return setError(c.lang === "he" ? "יש להזין מספר טלפון תקין." : "Enter a valid phone number.");
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return setError(c.lang === "he" ? "יש להזין כתובת אימייל תקינה." : "Enter a valid email address.");
    }
    if (password.length < 6) {
      return setError(c.lang === "he" ? "הסיסמה חייבת להכיל לפחות 6 תווים." : "Password must be at least 6 characters.");
    }
    if (mode === "signup" && !consent) return setError(t.auth.err.consent);

    setBusy(true);
    if (mode === "signup") {
      const { data, error: err } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            first_name: cleanFirst,
            last_name: cleanLast,
            phone: cleanPhone,
          },
        },
      });
      setBusy(false);
      if (err) return setError(err.message);
      if (!data.session) {
        setInfo(
          c.lang === "he"
            ? "נשלח אליך מייל לאימות החשבון. אשרי אותו ולאחר מכן התחברי."
            : "Verification email sent. Please confirm your email and then sign in."
        );
      }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      setBusy(false);
      if (err) {
        return setError(c.lang === "he" ? "האימייל או הסיסמה שגויים." : "Invalid email or password.");
      }
    }
  };

  return (
    <main className="stack">
      <section className="arch" style={{ padding: "3rem 1.5rem 1.5rem" }}>
        <h1 style={{ textAlign: "center" }}>{mode === "login" ? t.auth.login : t.auth.signup}</h1>
        <form onSubmit={submit} noValidate className="stack">
          <LangSelect label={t.auth.language} />
          {mode === "signup" && (
            <>
              <div>
                <label htmlFor="first-name">{c.lang === "he" ? "שם פרטי" : "First name"}</label>
                <input id="first-name" className="field" type="text" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="last-name">{c.lang === "he" ? "שם משפחה" : "Last name"}</label>
                <input id="last-name" className="field" type="text" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="phone">{c.lang === "he" ? "מספר טלפון" : "Phone number"}</label>
                <input id="phone" className="field ltr" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <label htmlFor="email">{c.lang === "he" ? "אימייל" : "Email"}</label>
            <input id="email" className="field ltr" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="password">{c.lang === "he" ? "סיסמה" : "Password"}</label>
            <input id="password" className="field ltr" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="help">{c.lang === "he" ? "לפחות 6 תווים" : "At least 6 characters"}</p>
          </div>
          {mode === "signup" && (
            <label className="row" style={{ alignItems: "flex-start", fontWeight: 350 }}>
              <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setError(""); }} style={{ marginTop: ".5rem" }} />
              <span>{t.auth.consent} (<a href="#/legal">{t.auth.consentLink}</a>)</span>
            </label>
          )}
          {error && <p id="auth-err" role="alert" className="err">{error}</p>}
          {info && <p role="status" className="ok">{info}</p>}
          <button type="submit" className="btn primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? (c.lang === "he" ? "מתחבר..." : "Please wait...") : mode === "login" ? t.auth.login : t.auth.signup}
          </button>
        </form>
      </section>
      <p style={{ textAlign: "center" }}>
        {mode === "login" ? t.auth.noAccount : t.auth.haveAccount}{" "}
        <a href={mode === "login" ? "#/signup" : "#/login"}>{mode === "login" ? t.auth.signup : t.auth.login}</a>
      </p>
    </main>
  );
}

function TxForm({ editing, onSubmit, onCancel }: { editing: Tx | null; onSubmit: (tx: Tx) => void; onCancel: () => void }) {
  const { t, cat } = useApp();
  const blank = (): Draft => ({ type: "expense", amount: "", date: new Date().toISOString().slice(0, 10), category: "", description: "" });
  const [d, setD] = useState<Draft>(() =>
    editing
      ? { type: editing.type, amount: String(editing.amount), date: editing.date, category: editing.category, description: editing.description }
      : blank()
  );
  const [errs, setErrs] = useState<Partial<Record<keyof Draft, DraftError>>>({});
  const head = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (editing) head.current?.focus();
  }, [editing]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateDraft(d);
    setErrs(found);
    const first = Object.keys(found)[0];
    if (first) {
      form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    onSubmit({ id: editing?.id ?? uid(), type: d.type, amount: Number(d.amount), date: d.date, category: d.category, description: d.description.trim() });
    if (!editing) setD(blank());
  };

  const err = (k: keyof Draft) => (errs[k] ? <p id={`${k}-err`} className="err">{t.form.e[errs[k] as DraftError]}</p> : null);
  const aria = (k: keyof Draft) => ({ "aria-invalid": errs[k] ? true : undefined, "aria-describedby": errs[k] ? `${k}-err` : undefined });
  const n = Object.keys(errs).length;

  return (
    <form ref={form} onSubmit={submit} noValidate className="stack">
      <h2 ref={head} tabIndex={-1}>{editing ? t.form.edit : t.form.add}</h2>
      {n > 0 && <p role="alert" className="note" style={{ color: "var(--danger-d)" }}>{t.form.errors(n)}</p>}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>{t.form.type}</legend>
        <div className="row" style={{ gap: "1.5rem" }}>
          {(["expense", "income"] as const).map((v) => (
            <label key={v} className="row" style={{ gap: ".5rem", fontWeight: 350 }}>
              <input type="radio" name="type" value={v} checked={d.type === v} onChange={() => set("type", v)} />
              {t.types[v]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="amount">{t.form.amount}</label>
        <input id="amount" name="amount" className="field ltr" inputMode="decimal" autoComplete="off" value={d.amount} onChange={(e) => set("amount", e.target.value)} {...aria("amount")} />
        {err("amount")}
      </div>
      <div>
        <label htmlFor="date">{t.form.date}</label>
        <input id="date" name="date" type="date" className="field" value={d.date} onChange={(e) => set("date", e.target.value)} {...aria("date")} />
        {err("date")}
      </div>
      <div>
        <label htmlFor="category">{t.form.category}</label>
        <select id="category" name="category" className="field" value={d.category} onChange={(e) => set("category", e.target.value)} {...aria("category")}>
          <option value="">{t.form.pick}</option>
          {CATEGORY_IDS.map((id) => <option key={id} value={id}>{cat(id)}</option>)}
        </select>
        {err("category")}
      </div>
      <div>
        <label htmlFor="description">{t.form.desc}</label>
        <input id="description" name="description" className="field" maxLength={120} autoComplete="off" value={d.description} onChange={(e) => set("description", e.target.value)} {...aria("description")} />
        {err("description")}
      </div>
      <div className="row">
        <button type="submit" className="btn primary">{editing ? t.form.saveBtn : t.form.addBtn}</button>
        {editing && <button type="button" className="btn" onClick={onCancel}>{t.form.cancel}</button>}
      </div>
    </form>
  );
}

function OverviewView() {
  const c = useApp();
  const { t, txs, setTxs, nis, date, cat, month } = c;
  const [editing, setEditing] = useState<Tx | null>(null);
  const [pending, setPending] = useState<Tx | null>(null);
  const [undo, setUndo] = useState<{ tx: Tx; index: number; list: Tx[] } | null>(null);
  const [status, setStatus] = useState("");
  const listHead = useRef<HTMLHeadingElement>(null);
  const focusList = () => setTimeout(() => listHead.current?.focus(), 0);
  useEffect(() => {
    if (undo && txs !== undo.list) setUndo(null);
  }, [txs, undo]);

  const m0 = monthKeyNow();
  const sum = summarize(txs, m0);
  const recent = [...txs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  const save = (tx: Tx) => {
    setUndo(null);
    if (editing) {
      setTxs(txs.map((x) => (x.id === tx.id ? tx : x)));
      setStatus(t.status.updated);
      setEditing(null);
      focusList();
    } else {
      setTxs([...txs, tx]);
      setStatus(t.status.added);
    }
  };

  const remove = () => {
    if (!pending) return;
    const next = txs.filter((x) => x.id !== pending.id);
    setUndo({ tx: pending, index: txs.findIndex((x) => x.id === pending.id), list: next });
    setTxs(next);
    setStatus(t.status.deleted);
    setPending(null);
    focusList();
  };

  const restore = () => {
    if (!undo) return;
    if (!txs.some((x) => x.id === undo.tx.id)) {
      const at = Math.min(Math.max(undo.index, 0), txs.length);
      setTxs([...txs.slice(0, at), undo.tx, ...txs.slice(at)]);
    }
    setUndo(null);
    setStatus(t.status.restored);
    focusList();
  };

  return (
    <main className="stack">
      <h1>{t.overview.title}</h1>
      <section aria-labelledby="sum-h">
        <h2 id="sum-h">{t.overview.summary(month(m0))}</h2>
        <dl className="cards">
          <div className="arch"><dt>{t.overview.income}</dt><dd>{nis(sum.income)}</dd></div>
          <div className="arch"><dt>{t.overview.expense}</dt><dd>{nis(sum.expense)}</dd></div>
          <div className="arch"><dt>{t.overview.balance}</dt><dd>{nis(Math.abs(sum.net))} {sum.net >= 0 ? t.overview.surplus : t.overview.deficit}</dd></div>
        </dl>
      </section>
      <TxForm key={editing?.id ?? "new"} editing={editing} onSubmit={save} onCancel={() => { setEditing(null); focusList(); }} />
      <p role="status" className="ok">{status}</p>
      <section aria-labelledby="recent-h" className="stack">
        <h2 id="recent-h" ref={listHead} tabIndex={-1}>{t.list.recent}</h2>
        {undo && (
          <div role="group" aria-label={t.undo.label} className="info-box row">
            <p style={{ margin: 0 }}>{t.undo.text(describe(c, undo.tx))}</p>
            <button type="button" className="btn primary" onClick={restore}>{t.undo.btn}</button>
            <button type="button" className="btn" aria-label={t.undo.closeAria} onClick={() => { setUndo(null); focusList(); }}>{t.undo.close}</button>
          </div>
        )}
        {pending && (
          <div role="alertdialog" aria-labelledby="del-h" aria-describedby="del-p" className="alert-box" onKeyDown={(e) => e.key === "Escape" && setPending(null)}>
            <h3 id="del-h">{t.confirm.title}</h3>
            <p id="del-p">{t.confirm.body(describe(c, pending))}</p>
            <div className="row">
              <button type="button" className="btn" autoFocus onClick={() => { setPending(null); focusList(); }}>{t.confirm.cancel}</button>
              <button type="button" className="btn danger" onClick={remove}>{t.confirm.yes}</button>
            </div>
          </div>
        )}
        {recent.length === 0 ? (
          <p>{t.list.empty}</p>
        ) : (
          <DataTable
            caption={t.list.caption}
            headers={[t.list.h.date, t.list.h.type, t.list.h.category, t.list.h.description, t.list.h.amount, t.list.h.actions]}
            rows={recent.map((tx) => [
              date(tx.date),
              t.types[tx.type],
              cat(tx.category),
              <>{tx.description || t.list.none}{tx.id === editing?.id && <strong> {t.list.editing}</strong>}</>,
              nis(tx.amount),
              <div className="row" style={{ gap: ".5rem" }}>
                <button type="button" className="btn" aria-label={t.list.editAria(describe(c, tx))} onClick={() => { setPending(null); setStatus(""); setEditing(tx); }}>{t.list.edit}</button>
                <button type="button" className="btn ghost" aria-label={t.list.delAria(describe(c, tx))} onClick={() => { if (editing?.id === tx.id) setEditing(null); setStatus(""); setPending(tx); }}>{t.list.del}</button>
              </div>,
            ])}
          />
        )}
      </section>
    </main>
  );
}

function SectionView({ type }: { type: TxType }) {
  const { t, txs, nis, month, date, cat } = useApp();
  const title = type === "income" ? t.section.income : t.section.expenses;
  const months = monthsOf(txs, type);
  const [open, setOpen] = useState<Set<string>>(() => new Set(months.slice(0, 1).map((m) => m.month)));
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <main className="wide stack">
      <h1>{title}</h1>
      {months.length === 0 ? (
        <p>{type === "income" ? t.section.emptyIncome : t.section.emptyExpenses}</p>
      ) : (
        <>
          <p className="help">{t.section.intro}</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setOpen(new Set(months.map((m) => m.month)))}>{t.section.expandAll}</button>
            <button type="button" className="btn" onClick={() => setOpen(new Set())}>{t.section.collapseAll}</button>
          </div>
          {months.map((m) => {
            const isOpen = open.has(m.month);
            return (
              <section key={m.month} className="box">
                <h2 style={{ margin: 0 }}>
                  <button type="button" className="acc-btn" aria-expanded={isOpen} aria-controls={`p-${type}-${m.month}`} id={`b-${type}-${m.month}`} onClick={() => toggle(m.month)}>
                    <span className="t">{month(m.month)}</span>
                    <span className="m">{t.section.count(m.count)} · {t.section.total(nis(m.total))}</span>
                    <Icon name="chevron" size={18} className={`chev${isOpen ? " open" : ""}`} />
                  </button>
                </h2>
                <div id={`p-${type}-${m.month}`} role="region" aria-labelledby={`b-${type}-${m.month}`} hidden={!isOpen} className="acc-body">
                  <DataTable
                    caption={t.section.caption(title, month(m.month))}
                    headers={t.section.headers}
                    rows={monthTxs(txs, type, m.month).map((x) => [date(x.date), x.description || t.list.none, cat(x.category), nis(x.amount)])}
                  />
                </div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}

function SearchView() {
  const { t, lang, txs, query, cat, date, nis } = useApp();
  const q = (query.get("q") ?? "").trim();
  const results = useMemo(() => searchTxs(txs, q, lang, cat), [txs, q, lang]);
  return (
    <main className="wide stack">
      <h1>{t.search.title}</h1>
      <p className="help">{t.search.hint}</p>
      {!q ? (
        <p>{t.search.prompt}</p>
      ) : results.length === 0 ? (
        <p role="status">{t.search.none(q)}</p>
      ) : (
        <>
          <p role="status">{t.search.results(results.length, q)}</p>
          <DataTable
            caption={t.search.caption}
            headers={t.search.headers}
            rows={results.map((x) => [date(x.date), t.types[x.type], cat(x.category), x.description || t.list.none, nis(x.amount)])}
          />
        </>
      )}
    </main>
  );
}

function AccountView() {
  const c = useApp();
  const { t, account, isAdmin, txs, setTxs, logout, deleteAccount } = c;
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<Tx[] | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  if (!account) return null;

  const onFile = async (e: { target: HTMLInputElement }) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    setMsg("");
    setErr("");
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setErr(t.account.tooLarge);
    const r = parseBackup(await f.text());
    if (!r.ok) return setErr(t.account.be[r.error]);
    setPending(r.txs);
  };

  return (
    <main className="stack">
      <h1>{t.account.title}</h1>
      {(account.firstName || account.lastName) && (
        <p><b>{c.lang === "he" ? "שם מלא" : "Full name"}: </b>{[account.firstName, account.lastName].filter(Boolean).join(" ")}</p>
      )}
      <p><b>{t.account.phone}: </b><span dir="ltr">{account.email ?? account.phone}</span></p>
      {account.phone && account.phone !== account.email && account.phone !== account.id && (
        <p><b>{c.lang === "he" ? "טלפון" : "Phone"}: </b><span dir="ltr">{account.phone}</span></p>
      )}
      <p><b>{t.account.role}: </b><span className={`badge${isAdmin ? " admin" : ""}`}>{isAdmin ? t.admin.roleAdmin : t.admin.roleUser}</span></p>
      <p role="note" className="note">{t.account.sim}</p>
      <section aria-labelledby="bk-h" className="stack">
        <h2 id="bk-h">{t.account.backupTitle}</h2>
        <p>{t.account.backupIntro}</p>
        <div>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              download(
                `budget-backup-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify({ app: "budget", version: 1, exportedAt: new Date().toISOString(), transactions: txs }, null, 2)
              );
              setMsg(t.account.exported(txs.length));
            }}
          >
            {t.account.export}
          </button>
        </div>
        <div>
          <label htmlFor="imp">{t.account.import}</label>
          <input id="imp" type="file" accept="application/json,.json" onChange={onFile} />
        </div>
        {pending && (
          <div role="alertdialog" aria-labelledby="rp-h" className="alert-box">
            <h3 id="rp-h">{t.account.replaceTitle}</h3>
            <p>{t.account.replaceBody(txs.length, pending.length)}</p>
            <div className="row">
              <button type="button" className="btn danger" onClick={() => { setTxs(pending); setMsg(t.account.imported(pending.length)); setPending(null); }}>{t.account.replace}</button>
              <button type="button" className="btn" onClick={() => setPending(null)}>{t.account.no}</button>
            </div>
          </div>
        )}
        <p role="status" className="ok">{msg}</p>
        {err && <p role="alert" className="err">{err}</p>}
      </section>
      <div><button type="button" className="btn" onClick={logout}>{t.account.logout}</button></div>
      <section aria-labelledby="dg-h" className="box stack" style={{ padding: "1rem", borderColor: "var(--danger)" }}>
        <h2 id="dg-h">{t.account.dangerTitle}</h2>
        <p>{t.account.dangerBody}</p>
        {!confirming ? (
          <div><button type="button" className="btn ghost" onClick={() => setConfirming(true)}>{t.account.delete}</button></div>
        ) : (
          <div role="alertdialog" aria-labelledby="dc-h" className="alert-box">
            <h3 id="dc-h">{t.account.confirmTitle}</h3>
            <p>{t.account.confirmBody}</p>
            <div className="row">
              <button type="button" className="btn" autoFocus onClick={() => setConfirming(false)}>{t.account.no}</button>
              <button type="button" className="btn danger" onClick={deleteAccount}>{t.account.yes}</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function AdminGate() {
  const { t, completeAdminGate, logout } = useApp();
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [left, setLeft] = useState(3);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await verifyAdminId(id);
    setBusy(false);
    setId("");
    if (r === "ok") return completeAdminGate(true);
    if (r === "format") return setError(t.gate.err.format);
    const n = left - 1;
    setLeft(n);
    if (n <= 0) completeAdminGate(false);
    else setError(t.gate.err.wrong(n));
  };

  return (
    <main className="stack">
      <section className="arch" style={{ padding: "3rem 1.5rem 1.5rem" }}>
        <h1 style={{ textAlign: "center" }}>{t.gate.title}</h1>
        <form onSubmit={submit} noValidate className="stack">
          <p>{t.gate.intro}</p>
          <div>
            <label htmlFor="admin-id">{t.gate.label}</label>
            <input id="admin-id" type="password" className="field ltr" inputMode="numeric" autoComplete="off" autoFocus value={id} onChange={(e) => setId(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "gate-err" : "gate-help"} />
            <p id="gate-help" className="help">{t.gate.help}</p>
          </div>
          {error && <p id="gate-err" role="alert" className="err">{error}</p>}
          <div className="row">
            <button type="submit" className="btn primary" disabled={busy}>{busy ? t.gate.checking : t.gate.verify}</button>
            <button type="button" className="btn" onClick={() => completeAdminGate(false)}>{t.gate.skip}</button>
            <button type="button" className="btn link-btn" onClick={logout}>{t.nav.logout}</button>
          </div>
          <p className="help">{t.gate.sim}</p>
        </form>
      </section>
    </main>
  );
}

function AdminView() {
  const { t, account, date } = useApp();
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<AdminRow | null>(null);
  const [msg, setMsg] = useState("");
  const stats = useMemo(() => adminStats(loadAccounts(), loadTxs), [version]);
  const A = t.admin;

  return (
    <main className="wide stack">
      <h1>{A.title}</h1>
      <p role="note" className="note">{A.note}</p>
      <dl className="cards">
        <div className="arch"><dt>{A.accounts}</dt><dd>{stats.accounts}</dd></div>
        <div className="arch"><dt>{A.active}</dt><dd>{stats.active}</dd></div>
        <div className="arch"><dt>{A.transactions}</dt><dd>{stats.transactions}</dd></div>
      </dl>
      <p role="status" className="ok">{msg}</p>
      {pending && (
        <div role="alertdialog" aria-labelledby="adm-h" className="alert-box" onKeyDown={(e) => e.key === "Escape" && setPending(null)}>
          <h3 id="adm-h">{A.confirmTitle(maskPhone(pending.phone))}</h3>
          <p>{A.confirmBody}</p>
          <div className="row">
            <button type="button" className="btn" autoFocus onClick={() => setPending(null)}>{A.no}</button>
            <button type="button" className="btn danger" onClick={() => { removeAccount(pending.id); setMsg(A.deleted(maskPhone(pending.phone))); setPending(null); setVersion((v) => v + 1); }}>{A.yes}</button>
          </div>
        </div>
      )}
      {stats.rows.length === 0 ? (
        <p>{A.empty}</p>
      ) : (
        <DataTable
          caption={A.caption}
          headers={A.headers}
          rows={stats.rows.map((r) => [
            <span dir="ltr">{maskPhone(r.phone)}</span>,
            date(r.createdAt.slice(0, 10)),
            String(r.count),
            <span className={`badge${r.isAdmin ? " admin" : ""}`}>{r.isAdmin ? A.roleAdmin : A.roleUser}</span>,
            r.id === account?.id ? "" : <button type="button" className="btn ghost" aria-label={A.deleteAria(maskPhone(r.phone))} onClick={() => { setMsg(""); setPending(r); }}>{A.delete}</button>,
          ])}
        />
      )}
    </main>
  );
}

function LegalView() {
  const { t, lang, date } = useApp();
  const o = OPERATOR[lang];
  const fill = (s: string) => s.replace("{name}", o.name).replace("{type}", o.type).replace("{city}", o.city).replace("{email}", OPERATOR.email);
  const L = t.legal;
  const rows: [string, string, string][] = [
    [KEYS.lang, L.purposes.lang, L.persistent],
    [KEYS.accounts, L.purposes.accounts, L.persistent],
    [`${KEYS.data}<id>`, L.purposes.data, L.persistent],
    [KEYS.session, L.purposes.session, L.sessionOnly],
    [KEYS.adminSession, L.purposes.adminSession, L.sessionOnly],
  ];

  return (
    <main className="stack">
      <h1>{L.title}</h1>
      <p className="help">{L.updated(date(OPERATOR.updated))}</p>
      {L.sections.map((s, i) => (
        <section key={s.title} className="stack">
          <h2>{s.title}</h2>
          {s.paras.map((p) => <p key={p}>{fill(p)}</p>)}
          {i === 1 && <DataTable caption={L.keysTitle} headers={L.keyHeaders} rows={rows.map(([k, p, d]) => [<span dir="ltr">{k}</span>, p, d])} />}
        </section>
      ))}
      <section>
        <h2>{L.contact}</h2>
        <p>{o.name}, {o.type}, {o.city}. {L.emailPrefix} <a href={`mailto:${OPERATOR.email}`} dir="ltr">{OPERATOR.email}</a></p>
      </section>
    </main>
  );
}

function Footer() {
  const { t } = useApp();
  return (
    <footer>
      <p><a href="#/legal">{t.nav.legal}</a></p>
      <p>{t.footer.disclaimer}</p>
    </footer>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { t, path, isAdmin, logout, go } = useApp();
  const [open, setOpen] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-width: 768px)").matches);
  const [q, setQ] = useState("");
  const main = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [path]);

  const items: [string, string, string][] = [
    ["/", "home", t.nav.overview],
    ["/income", "income", t.nav.income],
    ["/expenses", "expenses", t.nav.expenses],
    ["/search", "search", t.nav.search],
    ["/account", "account", t.nav.account],
    ...(isAdmin ? [["/admin", "admin", t.nav.admin] as [string, string, string]] : []),
    ["/legal", "legal", t.nav.legal],
  ];

  return (
    <div className="app">
      <a className="skip" href="#content" onClick={(e) => { e.preventDefault(); main.current?.focus(); }}>{t.skip}</a>
      <nav className={`side${open ? "" : " closed"}`} aria-label={t.nav.label}>
        <div className="side-top">
          <span className="brand"><Icon name="legal" /><span>{t.brand}</span></span>
          <button type="button" className="btn" aria-expanded={open} aria-controls="toc" onClick={() => setOpen(!open)}>
            <Icon name="menu" /><span className="sr">{open ? t.nav.close : t.nav.open}</span>
          </button>
        </div>
        <div id="toc" className={`toc${open ? "" : " hide"}`}>
          <h2 className="toc-title" style={{ fontSize: ".9rem", fontFamily: "inherit" }}>{t.nav.toc}</h2>
          <ul>
            {items.map(([to, icon, label]) => (
              <li key={to}>
                <a className="link" href={`#${to}`} aria-current={path === to || (to !== "/" && path.startsWith(to + "/")) ? "page" : undefined}>
                  <Icon name={icon} /><span>{label}</span>
                </a>
              </li>
            ))}
            <li>
              <button type="button" className="link" onClick={logout}><Icon name="logout" /><span>{t.nav.logout}</span></button>
            </li>
          </ul>
          <div className="keep" style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--bronze)" }}>
            <LangSelect />
          </div>
        </div>
      </nav>
      <div className="content">
        <div className="topbar">
          <form role="search" className="row" style={{ flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`); }}>
            <label htmlFor="gsearch" className="sr">{t.search.label}</label>
            <input id="gsearch" type="search" className="field" style={{ marginTop: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search.placeholder} autoComplete="off" />
            <button type="submit" className="btn primary"><Icon name="search" /><span>{t.search.btn}</span></button>
          </form>
        </div>
        <div id="content" tabIndex={-1} ref={main}>{children}</div>
        <Footer />
      </div>
    </div>
  );
}

function readHash(): { path: string; query: string } | null {
  const h = typeof location === "undefined" ? "" : location.hash;
  if (h === "" || h === "#") return { path: "/", query: "" };
  if (!h.startsWith("#/")) return null;
  const i = h.indexOf("?");
  return { path: i < 0 ? h.slice(1) : h.slice(1, i), query: i < 0 ? "" : h.slice(i + 1) };
}

export default function BudgetApp() {
  const [lang, setLangState] = useState<Lang>(() => {
    const s = ls.get(KEYS.lang);
    return s === "en" || s === "he" ? s : "he";
  });
  const [route, setRoute] = useState(() => readHash() ?? { path: "/", query: "" });
  const [account, setAccount] = useState<Account | null>(() => {
    const id = ss.get(KEYS.session);
    return id ? loadAccounts().find((a) => a.id === id) ?? null : null;
  });
  const [txs, setTxsState] = useState<Tx[]>(() => (account ? loadTxs(account.id) : []));
  const [saveFailed, setSaveFailed] = useState(false);
  const [adminMark, setAdminMark] = useState<string | null>(() => ss.get(KEYS.adminSession));
  const [challenge, setChallengeState] = useState<Challenge | null>(null);

  const t = DICT[lang];
  const dir = DIR[lang];
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = t.name;
  }, [lang, dir, t]);

  useEffect(() => {
    const f = () => {
      const n = readHash();
      if (n) setRoute(n);
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);

  useEffect(() => {
    let active = true;
    const syncUser = async (
      user: { id: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> } | null
    ) => {
      if (!active) return;
      if (!user) {
        setAccount(null);
        setTxsState([]);
        return;
      }
      const meta = user.user_metadata ?? {};
      const firstName = typeof meta.first_name === "string" ? meta.first_name : undefined;
      const lastName = typeof meta.last_name === "string" ? meta.last_name : undefined;
      const phoneMeta = typeof meta.phone === "string" ? meta.phone : undefined;
      const acc: Account = {
        id: user.id,
        phone: phoneMeta || user.email || user.id,
        email: user.email,
        firstName,
        lastName,
        createdAt: user.created_at ?? new Date().toISOString(),
      };
      ss.set(KEYS.session, acc.id);
      setAccount(acc);
      const cloud = await fetchCloudTxs(user.id);
      const local = loadTxs(user.id);
      const merged = cloud.length > 0 ? cloud : local;
      if (active) {
        setTxsState(merged);
        ls.set(KEYS.data + user.id, JSON.stringify(merged));
        await pushCloudTxs(acc, merged);
      }
    };

    supabase.auth.getSession().then(({ data }) => syncUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      syncUser(session?.user ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    ls.set(KEYS.lang, l);
  };

  const setTxs = (next: Tx[]) => {
    setTxsState(next);
    if (account) {
      ls.set(KEYS.data + account.id, JSON.stringify(next));
      pushCloudTxs(account, next).then((ok) => setSaveFailed(!ok));
    }
  };

  const go = (to: string) => {
    location.hash = to;
  };

  const requestCode = (_phoneInput: string, _mode: Mode): string | null => null;
  const verify = (_input: string): string | null => null;
  const completeAdminGate = (ok: boolean) => {
    const v = ok ? "ok" : "regular";
    ss.set(KEYS.adminSession, v);
    setAdminMark(v);
  };

  const logout = () => {
    supabase.auth.signOut();
    ss.del(KEYS.session);
    ss.del(KEYS.adminSession);
    setAdminMark(null);
    setAccount(null);
    setTxsState([]);
    setChallengeState(null);
    go("/login");
  };

  const deleteAccount = () => {
    if (account) removeAccount(account.id);
    setTxsState([]);
  };

  const fmt = useMemo(() => {
    const nf = new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency: "ILS" });
    const mf = new Intl.DateTimeFormat(LOCALE[lang], { month: "long", year: "numeric" });
    return {
      nis: (n: number) => nf.format(n),
      month: (k: string) => mf.format(new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1)),
      date: (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(LOCALE[lang]),
    };
  }, [lang]);

  const adminMatch = !!account && (isAdminPhone(account.email ?? "") || isAdminPhone(account.phone));

  const ctx: Ctx = {
    lang,
    dir,
    t,
    setLang,
    ...fmt,
    cat: (id) => t.cats[id] ?? id,
    account,
    isAdmin: adminMatch && adminMark === "ok",
    txs,
    setTxs,
    saveFailed,
    challenge,
    requestCode,
    verify,
    cancelChallenge: () => setChallengeState(null),
    logout,
    deleteAccount,
    completeAdminGate,
    path: route.path,
    query: new URLSearchParams(route.query),
    go,
  };

  let view: ReactNode;
  if (adminMatch && adminMark === null) {
    view = (
      <div>
        <header className="pub">
          <span className="brand"><Icon name="legal" /><span>{t.name}</span></span>
        </header>
        <div id="content" tabIndex={-1}><AdminGate /></div>
        <Footer />
      </div>
    );
  } else if (!account) {
    const body = route.path === "/legal" ? <LegalView /> : route.path === "/signup" ? <AuthView mode="signup" /> : <AuthView mode="login" />;
    view = (
      <div>
        <header className="pub">
          <a className="brand" href="#/login" style={{ textDecoration: "none" }}><Icon name="legal" /><span>{t.name}</span></a>
          {route.path === "/legal" && <div style={{ width: "10rem" }}><LangSelect /></div>}
        </header>
        <div id="content" tabIndex={-1}>{body}</div>
        <Footer />
      </div>
    );
  } else {
    const p = route.path;
    const page =
      p === "/income" ? (
        <SectionView type="income" />
      ) : p === "/expenses" ? (
        <SectionView type="expense" />
      ) : p === "/search" ? (
        <SearchView />
      ) : p === "/account" ? (
        <AccountView />
      ) : p === "/admin" && ctx.isAdmin ? (
        <AdminView />
      ) : p === "/legal" ? (
        <LegalView />
      ) : (
        <OverviewView />
      );
    view = (
      <Shell>
        {ctx.saveFailed && <p role="alert" className="note" style={{ margin: "1rem" }}>{t.auth.err.storage}</p>}
        {page}
      </Shell>
    );
  }

  return (
    <AppCtx.Provider value={ctx}>
      <style>{CSS}</style>
      {view}
    </AppCtx.Provider>
  );
}
