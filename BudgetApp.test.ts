import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MS, DICT, MAX_ATTEMPTS, RESEND_MS, createChallenge, generateCode, isRealIsoDate, isTx, maskPhone, monthsOf, monthTxs,
  ADMIN_ID_RECORD, ADMIN_PHONES, adminStats, hashId, isAdminPhone, isValidIsraeliId, normalizeIsraeliId, normalizePhone, parseBackup, searchTxs, secondsUntilResend, summarize, validateDraft, verifyAdminId, verifyCode, type Draft, type IdRecord, type Tx,
} from "./BudgetApp";

const tx = (id: string, type: "income" | "expense", date: string, amount = 100, category = "food", description = id): Tx => ({ id, type, amount, date, category, description });
const T0 = 1_000_000;

describe("טלפון: נרמול והסתרה", () => {
  it("מנקה רווחים, מקפים וסוגריים", () => {
    expect(normalizePhone("050-123 4567")).toBe("0501234567");
    expect(normalizePhone("(050) 1234567")).toBe("0501234567");
  });
  it("ממיר קידומת ישראל לאפס מוביל", () => {
    for (const p of ["+972501234567", "+972 50 123 4567", "00972501234567", "972501234567"]) expect(normalizePhone(p)).toBe("0501234567");
  });
  it("דוחה מספרים קצרים, ארוכים או עם אותיות", () => {
    for (const p of ["12345", "1234567890123456", "050-abc4567", "", "   "]) expect(normalizePhone(p)).toBe(null);
  });
  it("מסתיר את אמצע המספר", () => expect(maskPhone("0501234567")).toBe("050•••4567"));
});

describe("קוד אימות מדומה", () => {
  it("תמיד בן 4 ספרות בין 1000 ל-9999", () => { for (let i = 0; i < 300; i++) expect(generateCode()).toMatch(/^[1-9]\d{3}$/); });
  it("הקודים אינם זהים תמיד", () => expect(new Set(Array.from({ length: 40 }, generateCode)).size > 1).toBe(true));
  it("קובע תוקף, השהיה ומספר ניסיונות", () => {
    const c = createChallenge("0501234567", "login", T0, "4821");
    expect(c.expiresAt).toBe(T0 + CODE_TTL_MS);
    expect(c.resendAfter).toBe(T0 + RESEND_MS);
    expect(c.attemptsLeft).toBe(MAX_ATTEMPTS);
  });
  it("מקבל את הקוד הנכון, גם עם רווחים", () => {
    const c = createChallenge("0501234567", "signup", T0, "4821");
    expect(verifyCode(c, "4821", T0 + 1000).ok).toBe(true);
    expect(verifyCode(c, " 4821 ", T0 + 1000).ok).toBe(true);
  });
  it("קוד שגוי מוריד ניסיון, ואחרי שלושה הקוד ננעל (גם הנכון נדחה)", () => {
    let c = createChallenge("0501234567", "login", T0, "4821");
    const first = verifyCode(c, "1111", T0 + 1);
    expect(first.ok).toBe(false);
    if (!first.ok) { expect(first.reason).toBe("wrong"); expect(first.challenge.attemptsLeft).toBe(2); }
    for (let i = 0; i < MAX_ATTEMPTS; i++) { const r = verifyCode(c, "0000", T0 + 1); if (!r.ok) c = r.challenge; }
    const late = verifyCode(c, "4821", T0 + 2);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe("locked");
  });
  it("קוד שפג תוקפו נדחה", () => {
    const r = verifyCode(createChallenge("0501234567", "login", T0, "4821"), "4821", T0 + CODE_TTL_MS + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });
  it("סופר שניות לשליחה חוזרת, ומותר מיד כשהקוד פג או ננעל", () => {
    const c = createChallenge("0501234567", "login", T0, "4821");
    expect(secondsUntilResend(c, T0)).toBe(30);
    expect(secondsUntilResend(c, T0 + 10_000)).toBe(20);
    expect(secondsUntilResend(c, T0 + 30_000)).toBe(0);
    expect(secondsUntilResend(c, T0 + CODE_TTL_MS + 1)).toBe(0);
    expect(secondsUntilResend({ ...c, attemptsLeft: 0 }, T0)).toBe(0);
  });
});

describe("טפסים ותאריכים", () => {
  const ok: Draft = { type: "expense", amount: "120.50", date: "2026-11-16", category: "food", description: "קניות" };
  it("תאריכים: מקבל אמיתיים ודוחה בלתי אפשריים", () => {
    for (const d of ["2026-11-16", "2024-02-29"]) expect(isRealIsoDate(d)).toBe(true);
    for (const d of ["2026-02-30", "2025-02-29", "2026-13-01", "16/11/2026", ""]) expect(isRealIsoDate(d)).toBe(false);
  });
  it("טיוטה תקינה עוברת, וסכומים תקינים מתקבלים", () => {
    expect(validateDraft(ok)).toEqual({});
    for (const amount of ["12", "12.5", "0.99", "  7 "]) expect(validateDraft({ ...ok, amount })).toEqual({});
  });
  it("מבדיל בין סוגי שגיאות סכום", () => {
    for (const amount of ["", "0", "-5", "abc"]) expect(validateDraft({ ...ok, amount }).amount).toBe("amountPositive");
    expect(validateDraft({ ...ok, amount: "12.345" }).amount).toBe("amountDecimals");
    expect(validateDraft({ ...ok, amount: "100000001" }).amount).toBe("amountTooLarge");
  });
  it("דוחה תאריך, קטגוריה ותיאור לא תקינים", () => {
    expect(validateDraft({ ...ok, date: "2026-02-30" }).date).toBe("dateInvalid");
    expect(validateDraft({ ...ok, category: "מזון" }).category).toBe("categoryInvalid");
    expect(validateDraft({ ...ok, description: "א".repeat(101) }).description).toBe("descriptionTooLong");
    expect(validateDraft({ ...ok, description: "א".repeat(100) })).toEqual({});
  });
});

describe("חודשים, סיכומים וחיפוש", () => {
  const data = [tx("a", "expense", "2026-01-20", 50), tx("b", "expense", "2026-01-05", 25.5), tx("c", "income", "2026-01-01", 9000), tx("d", "expense", "2026-03-02", 10), tx("e", "income", "2025-12-31", 8000)];
  it("monthsOf: חודשי הסוג, מהחדש לישן, עם ספירה וסכום", () => {
    expect(monthsOf(data, "expense")).toEqual([{ month: "2026-03", count: 1, total: 10 }, { month: "2026-01", count: 2, total: 75.5 }]);
    expect(monthsOf(data, "income").map((m) => m.month)).toEqual(["2026-01", "2025-12"]);
    expect(monthsOf([], "income")).toEqual([]);
  });
  it("monthsOf: בלי שגיאות עיגול (0.1 + 0.2)", () => expect(monthsOf([tx("a", "expense", "2026-01-01", 0.1), tx("b", "expense", "2026-01-02", 0.2)], "expense")[0].total).toBe(0.3));
  it("monthTxs: לפי תאריך מהמוקדם למאוחר, ובסדר יציב באותו יום", () => {
    expect(monthTxs(data, "expense", "2026-01").map((t) => t.id)).toEqual(["b", "a"]);
    expect(monthTxs([tx("z", "expense", "2026-01-05"), tx("m", "expense", "2026-01-05")], "expense", "2026-01").map((t) => t.id)).toEqual(["m", "z"]);
  });
  it("summarize: הכנסות, הוצאות ויתרה לחודש", () => expect(summarize(data, "2026-01")).toEqual({ income: 9000, expense: 75.5, net: 8924.5 }));

  const labels: Record<string, string> = { food: "מזון", transport: "תחבורה" };
  const he = (id: string) => labels[id] ?? id;
  const sdata = [tx("1", "expense", "2026-01-05", 10, "food", "קפה בבית קפה"), tx("2", "expense", "2026-02-10", 10, "transport", "דלק לרכב"), tx("3", "expense", "2025-12-31", 10, "food", "Coffee beans")];
  it("חיפוש לפי תיאור, קטגוריה ותאריך", () => {
    expect(searchTxs(sdata, "דלק", "he", he).map((t) => t.id)).toEqual(["2"]);
    expect(searchTxs(sdata, "תחבורה", "he", he).map((t) => t.id)).toEqual(["2"]);
    expect(searchTxs(sdata, "2026-02", "he", he).map((t) => t.id)).toEqual(["2"]);
    expect(searchTxs(sdata, "5.1.2026", "he", he).map((t) => t.id)).toEqual(["1"]);
    expect(searchTxs(sdata, "פברואר", "he", he).map((t) => t.id)).toEqual(["2"]);
  });
  it("חיפוש: לא רגיש לאותיות, כל המילים חייבות להתאים, תוצאות מהחדש לישן", () => {
    expect(searchTxs(sdata, "  COFFEE ", "he", he).map((t) => t.id)).toEqual(["3"]);
    expect(searchTxs(sdata, "קפה מזון", "he", he).map((t) => t.id)).toEqual(["1"]);
    expect(searchTxs(sdata, "קפה תחבורה", "he", he)).toEqual([]);
    expect(searchTxs(sdata, "202", "he", he).map((t) => t.id)).toEqual(["2", "1", "3"]);
    expect(searchTxs(sdata, "   ", "he", he)).toEqual([]);
  });
  it("חיפוש באנגלית לפי שם החודש", () => expect(searchTxs(sdata, "february", "en", (id) => id).map((t) => t.id)).toEqual(["2"]));
});

describe("גיבוי", () => {
  const good = tx("1", "expense", "2026-11-16");
  const file = (transactions: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ app: "budget", version: 1, transactions, ...extra });
  it("isTx: מקבל עסקה תקינה ודוחה פגומה", () => {
    expect(isTx(good)).toBe(true);
    for (const bad of [{ ...good, amount: -1 }, { ...good, type: "gift" }, { ...good, date: "2026-02-30" }, { ...good, id: "" }, { id: "1" }, null, "x"]) expect(isTx(bad)).toBe(false);
  });
  it("קורא גיבוי תקין ומשדרג שמות קטגוריות עבריים", () => {
    const r = parseBackup(file([good, { ...good, id: "2", category: "מזון" }, { ...good, id: "3", category: "דבר משונה" }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.txs.map((t) => t.category)).toEqual(["food", "food", "other"]);
  });
  it("מחזיר קוד שגיאה לכל סוג כשל, והכול או כלום", () => {
    const err = (s: string) => { const r = parseBackup(s); return r.ok ? "ok" : r.error; };
    expect(err("{bad")).toBe("notJson");
    expect(err(JSON.stringify({ app: "x", version: 1, transactions: [] }))).toBe("notBackup");
    expect(err(file([], { version: 9 }))).toBe("badVersion");
    expect(err(file([good, { ...good, amount: -5 }]))).toBe("badRecords");
  });
});

describe("תפקיד מנהל/ת מערכת", () => {
  it("המספר 0536239587 מזוהה כמנהל/ת, גם בכתיב בינלאומי או עם מקפים", () => {
    for (const p of ["0536239587", "053-623-9587", "+972 53 623 9587", "972536239587"]) expect(isAdminPhone(p)).toBe(true);
  });
  it("כל מספר אחר, מספר לא תקין או ריק אינם מנהל/ת", () => {
    for (const p of ["0501234567", "0536239588", "536239587", "", "abc"]) expect(isAdminPhone(p)).toBe(false);
  });
  it("רשימת המנהלים כוללת בדיוק את המספר שהוגדר", () => expect([...ADMIN_PHONES]).toEqual(["0536239587"]));

  const accounts = [
    { id: "a", phone: "0501111111", createdAt: "2026-01-05T10:00:00Z" },
    { id: "b", phone: "0536239587", createdAt: "2026-03-01T10:00:00Z" },
    { id: "c", phone: "0502222222", createdAt: "2026-02-01T10:00:00Z" },
  ];
  const counts: Record<string, number> = { a: 3, b: 0, c: 2 };
  const txsOf = (id: string): Tx[] => Array.from({ length: counts[id] }, (_, i) => tx(`${id}${i}`, "expense", "2026-01-01"));
  it("adminStats: סופר חשבונות, חשבונות פעילים וסך העסקאות", () => {
    const st = adminStats(accounts, txsOf);
    expect(st.accounts).toBe(3);
    expect(st.active).toBe(2);
    expect(st.transactions).toBe(5);
  });
  it("adminStats: שורות מהחשבון החדש לישן, עם סימון המנהל/ת ומספר עסקאות בלבד", () => {
    const st = adminStats(accounts, txsOf);
    expect(st.rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(st.rows.map((r) => r.isAdmin)).toEqual([true, false, false]);
    expect(st.rows.map((r) => r.count)).toEqual([0, 2, 3]);
    expect(Object.keys(st.rows[0]).sort()).toEqual(["count", "createdAt", "id", "isAdmin", "phone"]);
  });
  it("adminStats: בלי חשבונות הכול אפס", () => expect(adminStats([], txsOf)).toEqual({ accounts: 0, active: 0, transactions: 0, rows: [] }));
});

describe("אימות תעודת זהות למנהל/ת", () => {
  // A made-up valid ID used only in tests; the record is built with few iterations to keep tests fast.
  const FAKE = "123456782";
  let record: IdRecord;
  const make = async () => (record ??= { salt: "AAECAwQFBgcICQoLDA0ODw==", iterations: 1000, hash: await hashId(FAKE, "AAECAwQFBgcICQoLDA0ODw==", 1000) });

  it("isValidIsraeliId: בודק ספרת ביקורת", () => {
    expect(isValidIsraeliId("123456782")).toBe(true);
    for (const bad of ["123456789", "12345678", "1234567822", "abcdefghi", ""]) expect(isValidIsraeliId(bad)).toBe(false);
  });
  it("normalizeIsraeliId: מנקה רווחים ומקפים, משלים אפסים, ודוחה מספר לא תקין", () => {
    expect(normalizeIsraeliId("123456782")).toBe("123456782");
    expect(normalizeIsraeliId(" 123-456-782 ")).toBe("123456782");
    expect(normalizeIsraeliId("00000018")).toBe("000000018");
    expect(normalizeIsraeliId("123456789")).toBe(null);
    expect(normalizeIsraeliId("1234")).toBe(null);
    expect(normalizeIsraeliId("abc")).toBe(null);
  });
  it("תעודת הזהות הנכונה מאומתת", async () => expect(await verifyAdminId(FAKE, await make())).toBe("ok"));
  it("תעודת זהות תקינה אך שגויה נדחית כ-wrong", async () => expect(await verifyAdminId("000000018", await make())).toBe("wrong"));
  it("קלט לא תקין מחזיר format, בלי לחשב תקציר", async () => {
    for (const bad of ["", "12", "123456789", "abc"]) expect(await verifyAdminId(bad, await make())).toBe("format");
  });
  it("אותה תעודה עם מלח אחר נותנת תקציר אחר", async () => expect((await hashId(FAKE, "AQIDBAUGBwgJCgsMDQ4PEA==", 1000)) === (await make()).hash).toBe(false));
  it("רשומת המנהל/ת בקוד אינה מכילה מספר זהות גלוי, והיא איטית מספיק", () => {
    expect(/\d{9}/.test(JSON.stringify(ADMIN_ID_RECORD))).toBe(false);
    expect(ADMIN_ID_RECORD.iterations >= 600000).toBe(true);
    expect(ADMIN_ID_RECORD.hash).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });
});

describe("מילוני השפה", () => {
  const paths = (o: unknown, p = ""): string[] => (typeof o !== "object" || o === null || Array.isArray(o) ? [p] : Object.entries(o).flatMap(([k, v]) => paths(v, p ? `${p}.${k}` : k)));
  it("לעברית ולאנגלית בדיוק אותם מפתחות", () => expect(paths(DICT.en).sort()).toEqual(paths(DICT.he).sort()));
  it("לכל מערך אותו אורך בשתי השפות", () => {
    const arrays = (o: unknown, p = ""): [string, number][] => (Array.isArray(o) ? [[p, o.length]] : typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => arrays(v, p ? `${p}.${k}` : k)) : []);
    expect(arrays(DICT.en)).toEqual(arrays(DICT.he));
  });
  it("פונקציות הטקסט מחזירות טקסט תקין בשתי השפות", () => {
    expect(DICT.en.auth.err.wrong(1)).toContain("1 attempt left");
    expect(DICT.en.form.errors(2)).toContain("2 errors");
    expect(DICT.he.auth.err.wrong(2)).toContain("2");
  });
});
