# Meridian Takeoff

Professional construction takeoff software built with React, TypeScript, and modern web technologies.

## Features

- **Project management** – Create, edit, delete, and organize construction projects
- **PDF upload & processing** – Upload drawings with OCR
- **Takeoff tools** – Area, linear, volume, and count measurements with cutout support
- **Conditions** – Custom takeoff conditions, cost rates, waste factors
- **Scale calibration** – Real-world scale calibration on drawings
- **Reporting** – Excel and PDF export
- **Backup / restore** – Project backup and restore
- **Views** – Grid/list project dashboard

## Tech stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Radix UI, Zustand
- **PDF:** PDF.js (pdfjs-dist)
- **Backend:** Express.js, TypeScript
- **Database:** Supabase (PostgreSQL)

## Getting started

### Prerequisites

Node.js 18+, Python 3.8+ (for backend scripts), npm, and a Supabase project.

### Quick start

1. **Environment** – Copy `.env.example` to `.env` (root) and `server/.env`. Add your Supabase URL and keys to both.

2. **Install**
   ```bash
   npm install
   cd server && npm install && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && cd ..
   ```

3. **Run** (two terminals)
   - **Backend:** `cd server && source venv/bin/activate && npm run dev`
   - **Frontend:** `npm run dev`

4. **Open** – [http://localhost:3001](http://localhost:3001)

**Full setup, troubleshooting, and daily workflow:** [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

### Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Start frontend dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run test` | Run tests |

## Project structure

```
├── src/
│   ├── components/     # UI (PDFViewer, TakeoffWorkspace, SheetSidebar, etc.)
│   ├── services/       # API, backup, OCR, etc.
│   ├── store/         # Zustand slices
│   ├── types/         # TypeScript types
│   └── utils/         # Helpers
├── server/            # Express API, Python scripts (PDF/OCR)
├── docs/              # DEVELOPMENT.md, TESTING.md, REFACTORING_AND_IMPROVEMENTS.md
└── scripts/           # dev-setup.sh, start-dev.sh
```

## Deployment

- **Frontend:** Vercel (`vercel` or connect repo)
- **Backend:** Deploy the Express app separately (e.g. Railway, Vercel serverless, DigitalOcean)

## Docs

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) – Local setup and troubleshooting
- [docs/TESTING.md](docs/TESTING.md) – Tests
- [docs/REFACTORING_AND_IMPROVEMENTS.md](docs/REFACTORING_AND_IMPROVEMENTS.md) – Refactoring log and next steps

## License

MIT. See the LICENSE file for details.
