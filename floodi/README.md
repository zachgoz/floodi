# FloodCast – Firebase Authentication

This app integrates Firebase Authentication with Ionic React, supporting both anonymous (guest) usage and email/password accounts.

## Setup

- Create a Firebase project at https://console.firebase.google.com/
- Add a Web App in Project Settings and copy your config values
- Enable Authentication providers: Email/Password and Anonymous
- Copy `.env.example` to `.env` and fill in values

```
cp .env.example .env
# edit .env with your Firebase config
```

Required env vars (from Firebase Console > Project Settings > General > Your apps > Web app):
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## Features

- Anonymous usage (guest mode) with full app access
- Seamless conversion from anonymous to registered account
- User registration, login, and password reset
- Profile page for display name and avatar updates
- Session persistence with browser storage
- Optional route protection and redirect to intended page
- User menu integrated into the Settings modal

## Development

- `npm run dev` to start
- Visit `/login`, `/register`, `/reset-password`, `/profile`

Auth context is provided app‑wide via `AuthProvider`. Routes can be wrapped with `PrivateRoute` and may opt-in to require auth; most routes are public to allow guest usage.

Anonymous accounts let users try FloodCast without friction. Creating an account will enable enhanced features in future phases.
