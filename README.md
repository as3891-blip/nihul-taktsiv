# Personal Budget (single-file edition)

The whole app is **one file**: `src/BudgetApp.tsx` (React only). Hebrew (RTL) and English (LTR), "Sage Atelier" design,
sidebar table of contents, Income / Expenses with expandable months, global search, simulated SMS sign-in.

## Important
- **Sign-in is a simulation.** No SMS is sent; the 4-digit code is shown on screen. It protects nothing.
- Data is stored **unencrypted in the browser only** (no server). Export a backup from the Account page.
- Have a lawyer review the privacy/terms text (inside `BudgetApp.tsx`, section 4) before a public launch.

## Admin role
Phone numbers listed in `ADMIN_PHONES` (top of `src/BudgetApp.tsx`) must also pass an **ID-number check** after the SMS-code step.
Only then do they get an "Administration" item in the menu; a wrong ID (3 tries) or "Continue as a regular user" gives the normal app.
The ID number is **not written in the code**: only a salted PBKDF2 hash (`ADMIN_ID_RECORD`) is stored, and the typed number is never saved or sent.
To change it, generate a new record (PBKDF2-SHA256, 600000 iterations, 16-byte random salt, base64) and replace `ADMIN_ID_RECORD`.
The admin screen shows statistics and account management for the accounts stored **on the same device**
(masked phone numbers and transaction counts only, never transaction contents). Everyone else sees no admin controls.
**This is not access control.** Everything runs in the browser: sign-in is simulated, the phone number is visible in the page source, and the ID hash can be attacked offline.
A real admin role needs a server that verifies the phone number by SMS and checks the role there.

## Run
```bash
npm install
npm run dev     # development
npm test        # logic + render tests (Hebrew test names)
npm run build   # production build into dist/
```

## Deploy to Vercel
Vercel does not take a ZIP. Unzip, create a GitHub repository, upload the folder's contents
(GitHub: **Add file > Upload files**), then in Vercel choose **Add New > Project > Import Git Repository**.
Framework preset: Vite (detected automatically). Build command `npm run build`, output `dist`.

## Edit the text
All Hebrew/English text is in the `he` and `en` objects in `BudgetApp.tsx`; a test checks they have the same keys.
Operator details (name, email, update date) are in the `OPERATOR` constant.
