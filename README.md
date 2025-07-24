# Floodi

Floodi is an Ionic React V8 application that visualizes coastal water levels and predicts road flooding. It blends NOAA water level predictions with Sunny Day Flood sensor data and shows when a road segment will be inundated.

## Features

- Interactive line chart of predicted and observed water levels using Chart.js
- Simple flood forecast summary listing predicted flood windows
- Data caching with IndexedDB (via localforage) for offline viewing
- Built with Ionic so it can be deployed as a PWA or wrapped with Capacitor for native iOS/Android builds

## Development

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

## Building

To build the production bundle:

```bash
npm run build
```

The output is generated in the `dist` directory. You can then use the Ionic Capacitor tooling to build native apps if desired.
