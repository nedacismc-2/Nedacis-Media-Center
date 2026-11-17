import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType, testConnection } from '../lib/firebase';

const BOOTSTRAP_ADMIN_EMAIL = 'nedacismc@gmail.com';

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  firebaseAuthReady: boolean;
  firebaseOnline: boolean;
  isFirebaseAdmin: boolean;
  signInWithGoogle: () => Promise<FirebaseUser>;
  signOutGoogle: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [firebaseOnline, setFirebaseOnline] = useState(true);
  const [isFirebaseAdmin, setIsFirebaseAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    testConnection().then((ok) => {
      if (active) setFirebaseOnline(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setIsFirebaseAdmin(false);
        setFirebaseAuthReady(true);
        return;
      }

      const emailLower = (user.email || '').trim().toLowerCase();
      let adminStatus = Boolean(user.emailVerified && emailLower === BOOTSTRAP_ADMIN_EMAIL);

      try {
        if (!adminStatus) {
          const adminSnap = await getDoc(doc(db, 'admins', user.uid));
          adminStatus = adminSnap.exists();
        }
      } catch {
        // Not in admins collection or not readable; keep adminStatus as computed
      }

      setIsFirebaseAdmin(adminStatus);

      // Ensure user profile doc exists in /users/{uid} with strict blueprint keys
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        const safeName = (user.displayName || user.email?.split('@')[0] || 'Pengguna NMC').slice(0, 120);
        const safeEmail = (user.email || '').slice(0, 160);
        const safePhoto = (user.photoURL || '').slice(0, 500);

        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            email: safeEmail,
            displayName: safeName,
            photoURL: safePhoto,
            role: adminStatus ? 'admin' : 'member',
            linkedMemberId: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(userRef, {
            displayName: safeName,
            photoURL: safePhoto,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        // Log non-fatal profile sync issues cleanly without crashing sign-in
        try {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
        } catch {
          // swallow inside auth listener
        }
      } finally {
        setFirebaseAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (): Promise<FirebaseUser> => {
    const result = await signInWithPopup(auth, googleProvider);
    setFirebaseOnline(true);
    return result.user;
  };

  const signOutGoogle = async () => {
    await signOut(auth);
  };

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        firebaseAuthReady,
        firebaseOnline,
        isFirebaseAdmin,
        signInWithGoogle,
        signOutGoogle,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
