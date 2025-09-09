# FloodCast – Firebase Auth + Firestore User Management

This app integrates Firebase Authentication with Ionic React and now includes Firestore-backed user profiles and a role-based permission system. It supports anonymous (guest) usage and email/password accounts.

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

- Anonymous usage (guest mode) with read-only access
- Seamless conversion from anonymous to registered account
- User registration, login, and password reset
- Profile page for display name and avatar updates
- Firestore user profiles with timestamps and activity status
- Role-based permissions: anonymous, user, moderator, admin
- Admin UI for managing user roles
- Session persistence with browser storage
- Optional route protection and redirect to intended page
- User menu integrated into the Settings modal

## Roles and Permissions

- anonymous: read-only, cannot create content
- user: can create/edit/delete own comments
- moderator: can edit/delete any comments, moderate content
- admin: full access including user management and analytics

Permissions are enforced in the client via utilities in `src/utils/permissions.ts` and at the database level via Firestore rules (`firestore.rules`).

## Firestore Setup

- In Firebase Console, enable Firestore (Production mode) and select a region
- Deploy Firestore security rules and indexes with Firebase CLI:

```
firebase deploy --only firestore
```

Project files:
- `firestore.rules` — security rules for users and comments
- `firestore.indexes.json` — indexes for efficient queries

## User Profiles

- Created automatically during registration or on first login
- Stored at `users/{uid}` with fields: uid, email, displayName, photoURL, role, createdAt, updatedAt, lastLoginAt, isActive
- Default role: `anonymous` for guest sessions, `user` for registered accounts

## Admin Role Management

- The Profile page includes an admin-only section to manage user roles
- Component: `src/components/admin/UserRoleManager.tsx`

## Development

- `npm run dev` to start
- Visit `/login`, `/register`, `/reset-password`, `/profile`

Auth context is provided app‑wide via `AuthProvider`. Routes can be wrapped with `PrivateRoute` and may opt-in to require auth; most routes are public to allow guest usage.

Anonymous accounts let users try FloodCast without friction. Creating an account will enable enhanced features in future phases.
