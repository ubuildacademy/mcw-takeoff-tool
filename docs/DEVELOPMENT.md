# Development Setup & Troubleshooting

Technical guide for local development: prerequisites, one-time setup, daily workflow, and troubleshooting.

## Prerequisites

- **Node.js 18+** – [nodejs.org](https://nodejs.org/)
- **Python 3.8+** – [python.org](https://www.python.org/downloads/) (for backend PDF/OCR scripts)
- **Git**
- **Supabase** – project URL and keys from your Supabase dashboard

## One-Time Setup

### 1. Environment variables

**Root `.env`** (frontend):

```bash
cp .env.example .env
```

Add your Supabase URL and anon key, and set `VITE_API_BASE_URL=http://localhost:4000/api` for local dev.

**`server/.env`** (backend):

```bash
cd server
cp ../.env.example .env
```

Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Set `PORT=4000` and `NODE_ENV=development`.

Get keys from Supabase Dashboard → Settings → API. Keep the service role key secret.

### 2. Optional setup script

```bash
./scripts/dev-setup.sh
```

### 3. Install dependencies

**Frontend (from repo root):**

```bash
npm install
```

**Backend:**

```bash
cd server
npm install
```

**Python (for PDF/OCR scripts):**

```bash
# In server/
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

If you hit issues with OpenCV/PyTorch, consider `brew install opencv` (macOS) or conda.

### 4. Verify Python scripts

```bash
ls server/src/scripts/
chmod +x server/src/scripts/*.py   # if needed
```

## Daily Workflow

### Start servers (two terminals)

**Terminal 1 – Backend:**

```bash
cd server
source venv/bin/activate   # if using venv
npm run dev
```

**Terminal 2 – Frontend:**

```bash
npm run dev
```

### Access app

Open **http://localhost:3001**

### Optional: single command

```bash
./scripts/start-dev.sh
```

### Stop

`Ctrl+C` in both terminals; run `deactivate` if you activated the venv.

## Troubleshooting

### Port already in use

**Frontend (3001):** `lsof -ti:3001 | xargs kill -9` or `npm run dev:fixed`  
**Backend (4000):** `lsof -ti:4000 | xargs kill -9`

### Python / venv

- Ensure venv is activated: `which python` should point into `venv/`
- Reinstall: `pip install -r requirements.txt`

### Supabase connection

- Check `.env` and `server/.env` for correct URL and keys
- No extra spaces; project active in Supabase dashboard

### CORS errors

- Backend must be running on port 4000
- Confirm `vite.config.ts` proxy and frontend API base URL point to `http://localhost:4000/api`

### Module not found

**Frontend:** `rm -rf node_modules package-lock.json && npm install`  
**Backend:** `cd server && rm -rf node_modules package-lock.json && npm install`

## Deploying

1. Test locally, then commit and push.
2. Vercel/Railway (or your host) will deploy from the repo; check their dashboards for status.

## Docs

- **README.md** – Overview and quick start
- **docs/REFACTORING_AND_IMPROVEMENTS.md** – Refactoring log and next steps
- **docs/TESTING.md** – Tests
- **docs/SUPABASE_SECURITY_CHECKLIST.md** – Supabase security (migrations, Auth)
