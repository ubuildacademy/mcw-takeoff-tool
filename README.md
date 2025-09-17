# Meridian Takeoff

A beautifully styled, intuitive takeoff software for construction professionals. Built with React, TypeScript, and modern web technologies.

## Features

### Core Functionality
- **PDF Viewer & Markup**: Advanced PDF viewing with custom canvas drawing tools for takeoff measurements
- **Job Management**: Complete project organization and management
- **Takeoff Conditions**: Support for linear, area, volume, and count measurements
- **Professional Reports**: Generate detailed quantity and cost reports
- **Sheet Management**: Organize and navigate through multiple PDF sheets

### Key Components
- **PDFViewer**: Core component with canvas overlay for markup and measurements
- **TakeoffSidebar**: Left sidebar with conditions, tools, and measurement settings
- **SheetSidebar**: Right sidebar for sheet navigation and management
- **ProjectList**: Home page with project overview and management

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS + Radix UI components
- **PDF Processing**: react-pdf with PDF.js
- **Icons**: Lucide React
- **Build Tool**: Vite
- **State Management**: React hooks (Zustand ready for future expansion)

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone [your-repository-url]
cd meridian-takeoff
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:3001`

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Project Structure

```
src/
├── components/
│   ├── ui/                 # Reusable UI components
│   │   ├── button.tsx
│   │   ├── badge.tsx
│   │   ├── input.tsx
│   │   └── separator.tsx
│   ├── PDFViewer.tsx       # Core PDF viewing and markup
│   ├── TakeoffSidebar.tsx  # Left sidebar with conditions
│   ├── SheetSidebar.tsx    # Right sidebar with sheets
│   ├── TakeoffWorkspace.tsx # Main workspace layout
│   └── ProjectList.tsx     # Home page
├── lib/
│   └── utils.ts           # Utility functions
├── App.tsx                # Main app component
├── main.tsx              # Entry point
└── index.css             # Global styles
```

## Key Features Explained

### PDF Viewer & Markup
The PDFViewer component is the heart of the application, featuring:
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

### Sheet Management
The SheetSidebar offers:
- Multi-page PDF navigation
- Sheet visibility controls
- Takeoff count tracking
- Grid and list view modes
- Sheet type categorization (Architectural, Structural, etc.)

## Development Roadmap

### Phase 1 (Current)
- ✅ Basic PDF viewing and markup
- ✅ Project management interface
- ✅ Takeoff condition management
- ✅ Sheet navigation

### Phase 2 (Next)
- [x] Backend API integration
- [ ] User authentication
- [x] Data persistence
- [ ] Real-time collaboration

### Phase 3 (Future)
- [ ] Advanced measurement tools
- [ ] Cost estimation engine
- [ ] Report generation
- [ ] Mobile app support

### UI/UX Improvements
- [ ] Implement progress indicator for PDF upload operations
- [ ] Enhance multi-page PDF navigation with improved dropdown interface
- [ ] Add visual enhancement to zoom controls with plus/minus icons
- [ ] Refactor project sheets view from grid to list layout
- [ ] Fix condition editing functionality in takeoff sidebar
- [ ] Implement automatic color assignment for new takeoff conditions

### Reporting & Export Features
- [ ] Generate comprehensive takeoff reports with quantities and costs
- [ ] Export takeoff data to Excel/CSV formats
- [ ] Create PDF reports with visual markup overlays
- [ ] Implement cost estimation with labor and material rates
- [ ] Add waste factor calculations for materials
- [ ] Generate summary reports by trade or system

### Advanced Features
- [ ] Implement takeoff measurement editing and deletion
- [ ] Add measurement validation and conflict detection
- [ ] Create custom takeoff templates and presets
- [ ] Implement project collaboration and sharing
- [ ] Add cloud storage and data synchronization
- [ ] Create user authentication and role management

## Deployment

### Vercel Deployment

This project is configured for Vercel deployment with a `vercel.json` configuration file.

1. **Install Vercel CLI** (optional):
```bash
npm i -g vercel
```

2. **Deploy to Vercel**:
```bash
vercel
```

3. **Or connect your GitHub repository** to Vercel through the web interface:
   - Go to [vercel.com](https://vercel.com)
   - Import your repository
   - Vercel will automatically detect this as a Vite project and deploy it

### Important Notes for Deployment

- **This is NOT a Next.js project** - it's a Vite + React application
- The `vercel.json` file configures Vercel to treat this as a static build
- The frontend runs on port 3001 in development
- The backend server is separate and would need its own deployment (consider Vercel Functions or a separate service)

### Backend Deployment

The backend server (`/server` directory) is a separate Express.js application that needs to be deployed independently. Consider:
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
