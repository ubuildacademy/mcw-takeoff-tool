# Quick Start Guide - Local Development

## One-Time Setup

1. **Run setup script** (optional but helpful):
   ```bash
   ./scripts/dev-setup.sh
   ```

2. **Configure environment variables**:
   - Edit `.env` (root) - Add Supabase URL and anon key
   - Edit `server/.env` - Add Supabase URL, anon key, and service role key

## Daily Development

### Start Development Servers

**Terminal 1 - Backend:**
```bash
cd server
source venv/bin/activate  # Only if using Python venv
npm run dev
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

### Access Application

Open browser: **http://localhost:3001**

### Stop Development

Press `Ctrl+C` in both terminals

## Troubleshooting

- **Port in use?** Run `npm run dev:fixed` for frontend
- **Python errors?** Make sure venv is activated: `source venv/bin/activate`
- **Module not found?** Run `npm install` in root and `server/` directories

## Full Documentation

See [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md) for complete setup instructions.
