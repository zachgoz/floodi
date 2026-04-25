/**
 * Firebase initialization and configuration (Auth + Firestore).
 *
 * - Reads config from Vite env vars
 * - Initializes the Firebase app once
 * - Exports the `auth` instance configured with robust persistence fallbacks
 * - Exports the `db` Firestore instance for data access
 * - Supports anonymous auth (must be enabled in Firebase Console)
 *
 * Firestore usage notes:
 * - Import `db` and use Firestore SDK helpers (e.g., `doc`, `getDoc`, `setDoc`).
 * - Prefer serverTimestamp() for createdAt/updatedAt fields when writing.
 * - Keep data access logic in service modules (e.g., src/lib/userService.ts).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

const isTestEnv = (() => {
  try {
    // Vitest sets import.meta.env.VITEST and MODE === 'test'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env: any = (import.meta as any)?.env ?? {};
    return env?.VITEST || env?.MODE === 'test';
  } catch {
    return false;
  }
})();

const requireEnv = (value: string | undefined, name: string): string => {
  if (value && value.length > 0) return value;
  if (isTestEnv) return `test-${name.toLowerCase()}`;
  throw new Error(`Missing required environment variable: ${name}`);
};

const env = import.meta.env;
const config: FirebaseConfig = {
  apiKey: requireEnv(env.VITE_FIREBASE_API_KEY, 'VITE_FIREBASE_API_KEY'),
  authDomain: requireEnv(env.VITE_FIREBASE_AUTH_DOMAIN, 'VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv(env.VITE_FIREBASE_PROJECT_ID, 'VITE_FIREBASE_PROJECT_ID'),
  storageBucket: requireEnv(env.VITE_FIREBASE_STORAGE_BUCKET, 'VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireEnv(env.VITE_FIREBASE_MESSAGING_SENDER_ID, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireEnv(env.VITE_FIREBASE_APP_ID, 'VITE_FIREBASE_APP_ID'),
};

/** Firebase application instance */
export const app: FirebaseApp = initializeApp(config);

/** Firebase Auth instance with local persistence */
export const auth: Auth = initializeAuth(app, {
  // Prefer IndexedDB for larger quota and Safari stability; fall back progressively.
  persistence: [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
  ],
});

/** Firestore database instance */
export const db: Firestore = getFirestore(app);

/**
 * Usage:
 * - Import `auth` and pass to Firebase Auth functions
 * - Import `db` and compose Firestore calls:
 *   ```ts
 *   import { db } from 'src/lib/firebase';
 *   import { doc, getDoc } from 'firebase/firestore';
 *   const snap = await getDoc(doc(db, 'users', uid));
 *   ```
 * - Ensure Anonymous authentication is enabled in Firebase Console to
 *   allow `signInAnonymously(auth)` from the client.
 */
