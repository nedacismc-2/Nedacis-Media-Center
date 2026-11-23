import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIREBASE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;
export const FIRESTORE_QUOTA_UPGRADE_URL = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;

let quotaExceededState = false;
const quotaListeners = new Set<(exceeded: boolean) => void>();

export function isQuotaExceededError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? String((error as { code?: unknown }).code || '') : '';
  const msg = error instanceof Error ? error.message : String(error || '');
  return (
    code === 'resource-exhausted' ||
    /quota\s*(limit\s*)?exceeded|resource[-_ ]exhausted|free daily read units/i.test(msg)
  );
}

export function markFirestoreQuotaExceeded(): void {
  if (quotaExceededState) return;
  quotaExceededState = true;
  console.warn(
    `Firestore daily free-tier read quota exceeded for database ${FIREBASE_DATABASE_ID}. Upgrade at: ${FIRESTORE_QUOTA_UPGRADE_URL}`
  );
  quotaListeners.forEach((cb) => cb(true));
}

export function isFirestoreQuotaExceeded(): boolean {
  return quotaExceededState;
}

export function subscribeQuotaExceeded(cb: (exceeded: boolean) => void): () => void {
  cb(quotaExceededState);
  quotaListeners.add(cb);
  return () => {
    quotaListeners.delete(cb);
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isQuotaExceededError(error)) {
    markFirestoreQuotaExceeded();
    throw new Error(
      'Kuota harian Firebase Firestore (paket Spark gratis) telah tercapai. Kuota akan direset otomatis besok.'
    );
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function handleSnapshotError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): void {
  if (isQuotaExceededError(error)) {
    markFirestoreQuotaExceeded();
    return;
  }
  handleFirestoreError(error, operationType, path);
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExceeded();
      return true;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration: the client is offline.');
      return false;
    }
    // Non-offline responses (e.g. permission-denied on test doc) mean Firestore server is reachable
    return true;
  }
}

void testConnection();
