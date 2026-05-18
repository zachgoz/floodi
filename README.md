# 🌊 FloodCast — Hyperlocal Tide & Coastal Flood Intelligence

Welcome to **FloodCast**, a premium, state-of-the-art mobile and web application engineered to deliver real-time, hyperlocal coastal flood intelligence and tidal forecasting.

By unifying data streams from standard National Oceanic and Atmospheric Administration (NOAA) tidal gauges and ultra-localized sensor networks (such as FiMAN / Sunny Day Flooding), FloodCast gives coastal communities, municipal planners, and emergency responders dynamic, predictive insight into rising waters.

---

## 🚀 Key Capabilities

FloodCast offers an immersive, interactive interface designed to make hydrographic data actionable:

*   **Real-Time D3 Hydrograph & Surge Analysis** — Visualizes the complex interplay between harmonic tide predictions, live observations, and computed storm surges. The system automatically extrapolates a surge-adjusted forecasting line to predict crossing points for minor, moderate, and major flooding thresholds.
*   **Atmospheric & Meteorological Overlay** — Live environmental tracking integrating wind direction/speeds, barometric pressure trends, and precipitation models powered by NOAA and Open-Meteo.
*   ** deck.gl Inundation Map & Simulation** — A geospatial spatial overlay combining mapbox layers and deck.gl to model affected street coordinates. Includes a manual slider to simulate tidal surges and see real-time flood area projection.
*   **Webcam Validation Timeline** — High-definition local webcam integrations featuring sequential slider tools, future forecast image prediction overlays, and skeleton loading frames to ensure visual verification.
*   **Collaborative Real-time Comments & Timeline** — Full-featured community boards for citizen science reporting. Includes real-time Firestore listeners, advanced metadata tags, multi-interval timelines (1 hour to 30 days), list views, and raw data export (JSON).
*   **Granular Role-Based Access Control (RBAC)** — A secured security model handling seamless migration from Anonymous (Guest) sessions to registered accounts, governed by robust Firestore security rules:
    *   `anonymous` — Read-only entry with minimal friction.
    *   `user` — Full access to interactive tools; creates and modifies own community observations.
    *   `moderator` — Admin-authorized to delete and flag community observations.
    *   `admin` — Complete control over configuration constants, user role elevations, and telemetry.

---

## 🛠 Tech Stack

FloodCast is built on a highly optimized, modern technology stack:

| Layer | Technologies & Frameworks |
| :--- | :--- |
| **Frontend Core** | React 19, TypeScript, Ionic React (v8), Vite (v5) |
| **Visualizations** | D3.js (Time-series charting), Deck.gl, @vis.gl/react-google-maps |
| **Styling** | Vanilla CSS (for ultimate visual excellence and cross-platform alignment) |
| **Mobile Runtime** | Capacitor (v7) (iOS / Android support) |
| **Backend Infrastructure** | Firebase (v12) (Auth, Firestore real-time collections, Static Hosting) |
| **Serverless Services** | Cloud Functions v2 (Scheduled NOAA/FiMAN Sync ETLs, CORS proxy layers) |
| **Testing Suite** | Vitest + React Testing Library (Unit), Cypress (End-to-End) |
| **Continuous Delivery** | Codemagic (automated native deployments) |

---

## 📁 Repository Directory Structure

The repository is structured as a workspace divided between local app development and serverless operations:

```
floodi/
├── .agent/                   # Custom Developer Agent guidelines & memory logs
├── AGENTS.md                 # Master Developer guidelines & style standards
├── SKILLS.md                 # Agent-specific workflows and capabilities
├── codemagic.yaml            # CI/CD instructions for automated building
└── floodi/                   # Ionic React Client and Firebase Operations Root
    ├── src/                  # Client React source files
    │   ├── App.tsx           # App shell and routing configuration
    │   ├── main.tsx          # Client entrypoint
    │   ├── components/       # Reusable components (e.g. HydrographChart, WebcamFeedCard)
    │   │   ├── admin/        # Admin telemetry and RBAC management tools
    │   │   ├── dashboard/    # Pure chart & spatial mapping elements
    │   │   └── Tab2/         # Main dashboard page layout and modular sub-views
    │   │       ├── hooks/    # Custom React hooks (e.g. useAtmosphericState, useChartData)
    │   │       └── types/    # Core domain TypeScript interfaces
    │   ├── pages/            # View pages (Intro, Login, Register, Profile, Tabs)
    │   ├── lib/              # Business logic, NOAA calculations, and Firestore services
    │   └── theme/            # Global variables and brand color palettes
    ├── functions/            # Firebase Cloud Functions (v2 ETL, proxy routines)
    ├── cypress/              # Cypress E2E automated test suites
    ├── public/               # Shared static assets and GeoJSON layers
    ├── firestore.rules       # Granular security policies for database reads/writes
    ├── firestore.indexes.json# Custom composite indexes for high-speed queries
    └── package.json          # Dependency configurations and execution scripts
```

---

## ⚡ Quick Start & Commands

To set up your local development environment, follow these steps:

### 1. Prerequisites
Ensure you have Node.js (version 20 or higher) and npm installed.

### 2. Environment Configuration
Copy the environment template in the project directory and populate it with your Firebase project configuration:
```bash
cp floodi/.env.example floodi/.env
```
Key configuration variables needed:
*   `VITE_FIREBASE_API_KEY`
*   `VITE_FIREBASE_AUTH_DOMAIN`
*   `VITE_FIREBASE_PROJECT_ID`
*   `VITE_FIREBASE_STORAGE_BUCKET`
*   `VITE_FIREBASE_MESSAGING_SENDER_ID`
*   `VITE_FIREBASE_APP_ID`

### 3. Running Scripts
All development and verification commands are run inside the `floodi/` subdirectory:

```bash
cd floodi/
```

| Command | Purpose |
| :--- | :--- |
| `npm install` | Install production and development dependencies |
| `npm run dev` | Start the Vite local development server (`http://localhost:5173`) |
| `npm run build` | Perform TypeScript type checking and compile optimized production bundles to `dist/` |
| `npm run preview` | Serve the compiled production build locally for verification |
| `npm run test.unit` | Run unit test suites (Vitest + Testing Library) |
| `npm run test.e2e` | Run End-to-End automated testing suite (Cypress) |
| `npm run lint` | Execute static ESLint checks on all `.ts` and `.tsx` source code |

---

## 📖 Complete Documentation Index

For exhaustive documentation regarding various facets of the codebase, please navigate to the specialized markdown guides:

*   📘 **[ARCHITECTURE.md](file:///Users/zgosling/sourcecode/floodi/floodi/ARCHITECTURE.md)** — Architectural design, data model structures, and data processing ETL flows.
*   📙 **[API.md](file:///Users/zgosling/sourcecode/floodi/floodi/API.md)** — Comprehensive NOAA datagetter API schema, FiMAN proxy specifications, and common data retrieval design patterns.
*   📗 **[DEPENDENCIES.md](file:///Users/zgosling/sourcecode/floodi/floodi/DEPENDENCIES.md)** — Detailed list of third-party dependencies, production/dev groupings, and core package overrides.
*   📓 **[AGENTS.md](file:///Users/zgosling/sourcecode/floodi/AGENTS.md)** — Code style compliance guidelines, testing targets, commit procedures, and naming conventions for developer agents.
*   🐳 **[floodi/README.md](file:///Users/zgosling/sourcecode/floodi/floodi/README.md)** — Deep dive into Firebase Auth registration, role-based authorization setups, and details about the real-time Comments Tab features.

---

> [!NOTE]
> This project is designed with strict modularity, high accessibility (a11y) considerations, and cross-platform native feel. Make sure to consult the appropriate documentation guides before contributing or running deployments.
