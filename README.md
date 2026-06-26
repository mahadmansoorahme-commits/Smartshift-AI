# SmartShiftAI

AI-powered workforce planning (Final Year Project). Upload sales CSV → train an ML
model → forecast demand → generate shift schedules → analyse labour cost.
Single-page Flask app with full **Supabase authentication + database integration**.

---

## ✅ What's implemented

- **Authentication (Supabase)** — email/password **sign up & log in**
- **Google sign-in** (OAuth — auto creates the account or logs in)
- **Forgot / reset password** (email link)
- **Account management** — change display name, change email, change password, delete account
- **Per-user database** — settings + every pipeline result (uploads, models, forecasts,
  schedules, cost analyses) saved per user with **Row-Level Security**
- **JWT-secured API** — every backend route verifies the user's token (401 if not logged in)
- **Data persistence** — uploaded CSVs stored in Supabase Storage and auto-restored after a restart

---

## 🚀 Setup (for teammates cloning the repo)

> The Supabase project (auth, database tables, Google login, storage) is **already set up
> and shared** — you do **not** need to create anything in Supabase or run any SQL.
> You only need the credentials and to run the app locally.

### 1. Prerequisites
- **Python 3.10+** and `pip`

### 2. Clone & install
```bash
git clone <repo-url>
cd SmartShiftAI
pip install -r requirements.txt
```

### 3. Create your `.env` file
The `.env` file holds secrets and is **gitignored** (not in the repo). Copy the template:
```bash
cp .env.example .env
```
Then open `.env` and fill in the values (**ask the project owner for these** — they are
shared privately, never committed):
```
SMARTSHIFT_SECRET=<any long random string>
FLASK_DEBUG=1
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon public key>
SUPABASE_JWT_SECRET=<jwt secret>
```
> Generate a `SMARTSHIFT_SECRET` with:
> `python -c "import secrets; print(secrets.token_hex(32))"`

### 4. Run
```bash
python app.py
```
Open **http://localhost:3000** (must be port **3000** — that's what Supabase auth is
configured for).

---

## 🧪 Quick test checklist
1. You land on the **login screen**.
2. **Sign up** (email/password) or click **Continue with Google** → reach the dashboard.
3. **Settings → Account**: change your name / password.
4. Run the pipeline: **Upload CSV → Train → Forecast → Schedule → Cost Analysis**.
5. **Log out** → log back in → your last dataset is restored.
6. (Optional) **Forgot password?** on the login screen sends a reset email.

Run the automated test suite:
```bash
python -m pytest -q
```

---

## 🛠 Tech stack
Flask · scikit-learn · pandas · Chart.js · Supabase (Auth + Postgres + Storage) · PyJWT

## 📦 Production
```bash
python serve.py      # waitress WSGI server, behind an HTTPS reverse proxy
```
