import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  isQuotaExceededError,
  markFirestoreQuotaExceeded,
  OperationType,
  testConnection,
} from '../lib/firebase';

const BOOTSTRAP_ADMIN_EMAIL = 'nedacismc@gmail.com';

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  firebaseAuthReady: boolean;
  firebaseOnline: boolean;
  isFirebaseAdmin: boolean;
  cloudPhotoUrl: string;
  signInWithGoogle: () => Promise<FirebaseUser>;
  signOutGoogle: () => Promise<void>;
  updateCloudUserPhoto: (photoUrl: string) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [firebaseOnline, setFirebaseOnline] = useState(true);
  const [isFirebaseAdmin, setIsFirebaseAdmin] = useState(false);
  const [cloudPhotoUrl, setCloudPhotoUrl] = useState('');

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
        setCloudPhotoUrl('');
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
        const safeGooglePhoto = (user.photoURL || '').slice(0, 500);

        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            email: safeEmail,
            displayName: safeName,
            photoURL: safeGooglePhoto,
            role: adminStatus ? 'admin' : 'member',
            linkedMemberId: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setCloudPhotoUrl(safeGooglePhoto);
        } else {
          const existingPhoto = String(userSnap.data().photoURL || '');
          const effectivePhoto =
            existingPhoto.startsWith('cloudfile://') || existingPhoto.startsWith('/uploads/')
              ? existingPhoto
              : safeGooglePhoto;
          setCloudPhotoUrl(effectivePhoto || existingPhoto);
          await updateDoc(userRef, {
            displayName: safeName,
            photoURL: effectivePhoto.slice(0, 500),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        if (isQuotaExceededError(err)) {
          markFirestoreQuotaExceeded();
        } else {
          // Log non-fatal profile sync issues cleanly without crashing sign-in
          try {
            handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
          } catch {
            // swallow inside auth listener
          }
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

  const updateCloudUserPhoto = async (photoUrl: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const cleanUrl = photoUrl.trim().slice(0, 500);
    setCloudPhotoUrl(cleanUrl);
    try {
      await updateDoc(doc(db, 'users', uid), {
        photoURL: cleanUrl,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        firebaseAuthReady,
        firebaseOnline,
        isFirebaseAdmin,
        cloudPhotoUrl,
        signInWithGoogle,
        signOutGoogle,
        updateCloudUserPhoto,
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
