// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BudgetApp, { KEYS, type Tx } from "./BudgetApp";

const data: Tx[] = [
  { id: "1", type: "income", amount: 9000, date: "2026-01-01", category: "salary", description: "משכורת ינואר" },
  { id: "2", type: "expense", amount: 120, date: "2026-01-05", category: "food", description: "קניות בסופר" },
  { id: "3", type: "expense", amount: 250, date: "2025-12-10", category: "transport", description: "דלק" },
  { id: "4", type: "income", amount: 500, date: "2025-12-01", category: "other", description: "בונוס דצמבר" },
];
// Prepares storage: a signed-in account with data (or nothing when `signedIn` is false) and the chosen language.
function setup(opts: { signedIn: boolean; lang?: "he" | "en"; phone?: string; adminMark?: "ok" | "regular" }) {
  localStorage.clear(); sessionStorage.clear();
  if (opts.lang) localStorage.setItem(KEYS.lang, opts.lang);
  if (opts.signedIn) {
    localStorage.setItem(KEYS.accounts, JSON.stringify([{ id: "a1", phone: opts.phone ?? "0501234567", createdAt: "2026-11-16T00:00:00Z" }, { id: "a2", phone: "0509998877", createdAt: "2026-11-17T00:00:00Z" }]));
    localStorage.setItem(KEYS.data + "a2", JSON.stringify([data[0]]));
    localStorage.setItem(KEYS.data + "a1", JSON.stringify(data));
    sessionStorage.setItem(KEYS.session, "a1");
    if (opts.adminMark) sessionStorage.setItem(KEYS.adminSession, opts.adminMark);
  }
}
const page = (hash: string): string => { location.hash = hash; return renderToString(createElement(BudgetApp)); };

describe("מסכי כניסה והרשמה", () => {
  it("בלי חשבון מחובר מוצג מסך כניסה בעברית עם הודעת ההדמיה", () => {
    setup({ signedIn: false });
    const html = page("");
    expect(html).toContain("כניסה");
    expect(html).toContain("לא נשלח SMS אמיתי");
    expect(html).toContain("מספר טלפון");
    expect(html).toContain("בחירת שפה");
  });
  it("מסך ההרשמה כולל בחירת שפה ואישור מדיניות פרטיות", () => {
    setup({ signedIn: false });
    const html = page("#/signup");
    expect(html).toContain("יצירת חשבון");
    expect(html).toContain("עברית");
    expect(html).toContain("English");
    expect(html).toContain("מדיניות הפרטיות");
    expect(html).toContain('type="checkbox"');
  });
  it("כשהשפה באנגלית כל המסך באנגלית", () => {
    setup({ signedIn: false, lang: "en" });
    const html = page("#/signup");
    expect(html).toContain("Create an account");
    expect(html).toContain("Phone number");
    expect(html).toContain("Send me a verification code");
    expect(html.includes("מספר טלפון")).toBe(false);
  });
  it("דף הפרטיות נגיש גם בלי להתחבר", () => {
    setup({ signedIn: false });
    const html = page("#/legal");
    expect(html).toContain("פרטיות, תנאים ונגישות");
    expect(html).toContain("budget:accounts");
  });
});

describe("אחרי כניסה: תפריט צד ודפי האפליקציה", () => {
  it("המסך הראשי כולל תוכן עניינים, חיפוש, סיכום וטופס", () => {
    setup({ signedIn: true });
    const html = page("");
    expect(html).toContain("תוכן עניינים");
    expect(html).toContain('role="search"');
    expect(html).toContain("הוספת עסקה");
    expect(html).toContain("עסקאות אחרונות");
    expect(html).toContain("קניות בסופר");
    expect(html).toContain('aria-controls="toc"');
  });
  it("התוכן כולל את סעיפי הכנסות והוצאות", () => {
    setup({ signedIn: true });
    const html = page("");
    expect(html).toContain('href="#/income"');
    expect(html).toContain('href="#/expenses"');
    expect(html).toContain('href="#/search"');
  });
  it("דף ההכנסות מציג חודשים נפתחים, והחודש האחרון פתוח", () => {
    setup({ signedIn: true });
    const html = page("#/income");
    expect(html).toContain("ינואר 2026");
    expect(html).toContain("דצמבר 2025");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("משכורת ינואר");
  });
  it("דף ההוצאות מציג את החודשים של ההוצאות בלבד", () => {
    setup({ signedIn: true });
    const html = page("#/expenses");
    expect(html).toContain("ינואר 2026");
    expect(html).toContain("קניות בסופר");
    expect(html.includes("משכורת ינואר")).toBe(false);
  });
  it("חיפוש מציג תוצאות מכל החודשים", () => {
    setup({ signedIn: true });
    const html = page("#/search?q=" + encodeURIComponent("דלק"));
    expect(html).toContain("נמצאו 1 תוצאות");
    expect(html).toContain("דלק");
    expect(html.includes("קניות בסופר")).toBe(false);
  });
  it("חיפוש ללא תוצאות מציג הודעה", () => {
    setup({ signedIn: true });
    expect(page("#/search?q=" + encodeURIComponent("אין כזה"))).toContain("לא נמצאו תוצאות");
  });
  it("דף החשבון מציג טלפון מוסתר וגיבוי", () => {
    setup({ signedIn: true });
    const html = page("#/account");
    expect(html).toContain("050•••4567");
    expect(html).toContain("גיבוי ושחזור");
  });
  it("באנגלית: תפריט, הכנסות ושמות חודשים באנגלית", () => {
    setup({ signedIn: true, lang: "en" });
    expect(page("")).toContain("Table of contents");
    const html = page("#/income");
    expect(html).toContain("January 2026");
    expect(html).toContain("Income");
  });
});

describe("תפקיד מנהל/ת מערכת", () => {
  const ADMIN = "0536239587";
  it("משתמש/ת רגיל/ה לא רואה פריט ניהול בתפריט", () => {
    setup({ signedIn: true });
    const html = page("");
    expect(html.includes('href="#/admin"')).toBe(false);
    expect(html.includes("ניהול מערכת")).toBe(false);
  });
  it("משתמש/ת רגיל/ה שמגיע ישירות לכתובת הניהול מקבל/ת את המסך הראשי, בלי נתוני ניהול", () => {
    setup({ signedIn: true });
    const html = page("#/admin");
    expect(html).toContain("הוספת עסקה");
    expect(html.includes("חשבונות במכשיר")).toBe(false);
    expect(html.includes("050•••8877")).toBe(false);
  });
  it("מנהל/ת רואה את פריט הניהול בתוכן העניינים", () => {
    setup({ signedIn: true, phone: ADMIN, adminMark: "ok" });
    expect(page("")).toContain('href="#/admin"');
  });
  it("מסך הניהול מציג סטטיסטיקות וחשבונות עם מספרי טלפון מוסתרים, בלי תוכן עסקאות", () => {
    setup({ signedIn: true, phone: ADMIN, adminMark: "ok" });
    const html = page("#/admin");
    expect(html).toContain("ניהול מערכת");
    expect(html).toContain("חשבונות במכשיר");
    expect(html).toContain("053•••9587");
    expect(html).toContain("050•••8877");
    expect(html).toContain("מנהל/ת מערכת");
    expect(html.includes("משכורת ינואר")).toBe(false);
    expect(html.includes("0509998877")).toBe(false);
  });
  it("למנהל/ת אין כפתור מחיקה לחשבון של עצמו/ה, אבל יש לחשבונות אחרים", () => {
    setup({ signedIn: true, phone: ADMIN, adminMark: "ok" });
    const html = page("#/admin");
    expect(html).toContain("מחיקת החשבון 050•••8877");
    expect(html.includes("מחיקת החשבון 053•••9587")).toBe(false);
  });
  it("בדף החשבון מוצג התפקיד", () => {
    setup({ signedIn: true, phone: ADMIN, adminMark: "ok" });
    expect(page("#/account")).toContain("מנהל/ת מערכת");
    setup({ signedIn: true });
    expect(page("#/account")).toContain("משתמש/ת");
  });
  it("באנגלית: מסך הניהול והתפקיד באנגלית", () => {
    setup({ signedIn: true, phone: ADMIN, lang: "en", adminMark: "ok" });
    const html = page("#/admin");
    expect(html).toContain("System administration");
    expect(html).toContain("Accounts on this device");
    expect(html).toContain("System administrator");
  });

  it("מספר המנהל/ת בלי אימות תעודת זהות: מוצג מסך אימות במקום האפליקציה, בלי פריט ניהול", () => {
    setup({ signedIn: true, phone: ADMIN });
    const html = page("");
    expect(html).toContain("אימות מנהל/ת מערכת");
    expect(html).toContain("מספר תעודת זהות");
    expect(html).toContain("המשך כמשתמש/ת רגיל/ה");
    expect(html.includes('href="#/admin"')).toBe(false);
    expect(html.includes("הוספת עסקה")).toBe(false);
  });
  it("שדה תעודת הזהות מוסתר (password) ואינו נשמר", () => {
    setup({ signedIn: true, phone: ADMIN });
    const html = page("#/admin");
    expect(html).toContain('type="password"');
    expect(html).toContain("אימות מנהל/ת מערכת");
    expect(html.includes("חשבונות במכשיר")).toBe(false);
  });
  it("מי שנכשל/ה באימות (regular) ממשיך/ה כמשתמש/ת רגיל/ה בלי בקרות ניהול", () => {
    setup({ signedIn: true, phone: ADMIN, adminMark: "regular" });
    expect(page("")).toContain("הוספת עסקה");
    expect(page("").includes('href="#/admin"')).toBe(false);
    const adminPage = page("#/admin");
    expect(adminPage.includes("חשבונות במכשיר")).toBe(false);
    expect(page("#/account")).toContain("משתמש/ת");
  });
  it("משתמש/ת רגיל/ה אינו נדרש/ת להזין תעודת זהות", () => {
    setup({ signedIn: true });
    const html = page("");
    expect(html.includes("אימות מנהל/ת מערכת")).toBe(false);
    expect(html).toContain("הוספת עסקה");
  });
  it("באנגלית: מסך אימות המנהל/ת", () => {
    setup({ signedIn: true, phone: ADMIN, lang: "en" });
    const html = page("");
    expect(html).toContain("Administrator verification");
    expect(html).toContain("ID number");
    expect(html).toContain("Continue as a regular user");
  });
  it("בטבלת מפתחות האחסון מופיע גם מפתח אימות המנהל/ת", () => {
    setup({ signedIn: false });
    expect(page("#/legal")).toContain("session:admin");
  });
});
