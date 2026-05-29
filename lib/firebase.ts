import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfigLocal from '../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfigLocal) : getApp();
export const db = getFirestore(app, firebaseConfigLocal.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
