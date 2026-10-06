import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const required = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
const emulatorRequested =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
const emulatorEnabled =
  emulatorRequested && process.env.NODE_ENV !== "production";
const placeholderInProduction =
  process.env.NODE_ENV === "production" &&
  (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.startsWith("demo-") === true ||
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY === "demo-api-key" ||
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.includes("founderosdemo") ===
      true);

export const firebaseReady =
  (missing.length === 0 && !placeholderInProduction) || emulatorEnabled;
export const firebaseMissing = placeholderInProduction
  ? ["production Firebase Web App configuration"]
  : missing;
export const isFirebaseEmulator = emulatorEnabled;

const fallback = emulatorEnabled
  ? {
      apiKey: "demo-api-key",
      authDomain: "localhost",
      projectId: "demo-founderos",
      storageBucket: "demo-founderos.appspot.com",
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:founderosdemo",
    }
  : {
      apiKey: "unconfigured",
      authDomain: "localhost",
      projectId: "unconfigured",
      storageBucket: "unconfigured.appspot.com",
      messagingSenderId: "000000000000",
      appId: "unconfigured",
    };

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || fallback.apiKey,
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || fallback.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || fallback.projectId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || fallback.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    fallback.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || fallback.appId,
  ...(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
    ? { databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL }
    : {}),
  ...(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
    ? { measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID }
    : {}),
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

if (
  typeof window !== "undefined" &&
  firebaseReady &&
  !isFirebaseEmulator &&
  firebaseConfig.measurementId
) {
  void isSupported()
    .then((supported) => {
      if (supported) getAnalytics(app);
    })
    .catch(() => undefined);
}

let emulatorsConnected = false;
if (typeof window !== "undefined" && emulatorEnabled && !emulatorsConnected) {
  const authHost =
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1";
  const authPort = Number(
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT || 9099,
  );
  const firestoreHost =
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || "127.0.0.1";
  const firestorePort = Number(
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT || 8080,
  );
  connectAuthEmulator(auth, `http://${authHost}:${authPort}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, firestoreHost, firestorePort);
  const storageHost =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1";
  const storagePort = Number(
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_PORT || 9199,
  );
  connectStorageEmulator(storage, storageHost, storagePort);
  emulatorsConnected = true;
}
