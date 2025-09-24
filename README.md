# Meridian Takeoff

Professional construction takeoff software built with React, TypeScript, and modern web technologies.

## Features

### ✅ Core Functionality
- **Project Management**: Create, edit, delete, and organize construction projects
- **PDF Upload & Processing**: Upload and process construction drawings with OCR
- **Takeoff Tools**: Area, linear, volume, and count measurement tools
- **Condition Management**: Create and manage takeoff conditions with custom properties
- **Measurement System**: Precise takeoff measurements with cutout support
- **Scale Calibration**: Accurate scale calibration for real-world measurements
- **Professional Reporting**: Excel and PDF export with industry-standard formatting
- **Project Backup/Restore**: Complete project data backup and restore system
- **Grid/List Views**: Flexible project dashboard with view mode switching

### Key Components
- **PDFViewer**: Core component with canvas overlay for markup and measurements
- **TakeoffSidebar**: Left sidebar with conditions, tools, and measurement settings
- **SheetSidebar**: Right sidebar for sheet navigation and management
- **ProjectList**: Home page with project overview and management
- **BackupDialog**: Project backup and restore functionality

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS + Radix UI components
- **PDF Processing**: react-pdf with PDF.js
- **Icons**: Lucide React
- **Build Tool**: Vite
- **State Management**: Zustand
- **Backend**: Express.js + TypeScript
- **Database**: Supabase (PostgreSQL)

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ubuildacademy/mcw-takeoff-tool.git
cd mcw-takeoff-tool
```

2. Install frontend dependencies:
```bash
npm install
```

3. Install backend dependencies:
```bash
cd server
npm install
cd ..
```

4. Start the backend server:
```bash
cd server
npm run dev
```

5. Start the frontend development server (in a new terminal):
```bash
npm run dev
```

6. Open your browser and navigate to `http://localhost:3001`

### Available Scripts

- `npm run dev` - Start frontend development server
- `npm run build` - Build frontend for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Project Structure

```
├── src/
│   ├── components/
│   │   ├── ui/                 # Reusable UI components
│   │   ├── PDFViewer.tsx       # Core PDF viewing and markup
│   │   ├── TakeoffSidebar.tsx  # Left sidebar with conditions
│   │   ├── SheetSidebar.tsx    # Right sidebar with sheets
│   │   ├── TakeoffWorkspace.tsx # Main workspace layout
│   │   ├── ProjectList.tsx     # Home page
│   │   └── BackupDialog.tsx    # Backup/restore functionality
│   ├── services/
│   │   ├── apiService.ts       # API communication
│   │   └── backupService.ts    # Backup/restore service
│   ├── store/
│   │   └── useTakeoffStore.ts  # State management
│   ├── types/
│   │   └── index.ts            # TypeScript definitions
│   └── utils/
│       └── commonUtils.ts      # Utility functions
├── server/
│   ├── src/
│   │   ├── routes/             # API routes
│   │   ├── storage.ts          # Database operations
│   │   └── index.ts            # Server entry point
│   └── uploads/                # File storage
└── DEVELOPMENT_ROADMAP.md      # Current development priorities
```

## Key Features Explained

### PDF Viewer & Markup
The PDFViewer component features:
- PDF.js integration for fast rendering
- Custom HTML5 canvas for drawing tools
- Support for linear, area, volume, and count measurements
- PDF-relative coordinate system for persistent positioning
- Zoom, pan, and rotation controls
- Search functionality within documents

### Takeoff Conditions
The TakeoffSidebar provides:
- Pre-defined takeoff conditions (concrete, drywall, electrical, etc.)
- Custom condition creation
- Cost calculations with labor and material rates
- Waste factor management
- Unit conversion support

### Project Backup/Restore
- Individual project backup with download icons
- Comprehensive JSON backup files
- File upload restore functionality
- Complete project data portability

## Current Development Priorities

See [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) for current issues and development priorities.

## Deployment

### Frontend (Vercel)
This project is configured for Vercel deployment:

1. **Deploy to Vercel**:
```bash
vercel
```

2. **Or connect your GitHub repository** to Vercel through the web interface

### Backend
The backend server is a separate Express.js application that needs to be deployed independently. Consider:
- Vercel Functions
- Railway
- Heroku
- DigitalOcean App Platform

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue in the GitHub repository or contact the development team.