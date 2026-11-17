import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  AdminLmsSubmission,
  AdminLmsTask,
  AttendanceRecord,
  LmsTask,
  LmsTaskStage,
  NewsArticle,
  NotificationItem,
  ScheduleItem,
  SiteBranding,
  SocialLinkItem,
  StudentProfile,
  StudentWork,
  WorkComment,
} from '../types';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

export function sanitizeDocId(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return clean || `doc_${Date.now()}`;
}

function clampStr(val: unknown, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

export function deterministicNumericId(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2000000000 + 1;
}

export async function sha256Hex(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildMemberAuthHashes(params: {
  qrCodeToken?: string;
  nis?: string;
  password?: string;
  existingHashes?: string[];
}): Promise<string[]> {
  const set = new Set<string>(
    (params.existingHashes || []).filter((h) => typeof h === 'string' && h.length === 64)
  );
  const candidates = [
    params.qrCodeToken?.trim().toLowerCase(),
    params.nis?.trim().toLowerCase(),
    params.password?.trim(),
    params.password?.trim().toLowerCase(),
  ].filter((v): v is string => Boolean(v));

  for (const c of candidates) {
    const hex = await sha256Hex(c);
    set.add(hex);
  }
  return Array.from(set).slice(0, 6);
}

// ==================== SITE SETTINGS (BRANDING / HERO / FOOTER / SOCIAL) ====================

export function subscribeSiteSettings(
  onData: (settings: SiteBranding | null) => void
): Unsubscribe {
  const path = 'site_settings/portal';
  return onSnapshot(
    doc(db, 'site_settings', 'portal'),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        brandName: String(d.brandName ?? 'Multimedia'),
        logoUrl: String(d.logoUrl ?? ''),
        heroEyebrow: String(d.heroEyebrow ?? ''),
        heroTitle: String(d.heroTitle ?? 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis'),
        heroDescription: String(d.heroDescription ?? ''),
        heroImageUrl: String(d.heroImageUrl ?? ''),
        footerAddress: String(d.footerAddress ?? ''),
        socialLinks: Array.isArray(d.socialLinks) ? (d.socialLinks as SocialLinkItem[]) : [],
      });
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export async function saveSiteSettingsToFirestore(settings: SiteBranding): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google Admin untuk menyimpan pengaturan ke Firebase.');
  const path = 'site_settings/portal';
  const cleanedSocial = (settings.socialLinks || []).slice(0, 12).map((s, idx) => ({
    id: clampStr(s.id || `soc_${idx}`, 40) || `soc_${idx}`,
    platform: s.platform || 'website',
    label: clampStr(s.label || s.platform, 40) || 'Sosial',
    url: clampStr(s.url, 300),
    customIconUrl: clampStr(s.customIconUrl, 500),
  }));

  try {
    await setDoc(doc(db, 'site_settings', 'portal'), {
      brandName: clampStr(settings.brandName || 'Multimedia', 60) || 'Multimedia',
      logoUrl: clampStr(settings.logoUrl, 500),
      heroEyebrow: clampStr(settings.heroEyebrow, 120),
      heroTitle:
        clampStr(
          settings.heroTitle || 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis',
          160
        ) || 'Nedacis Media Center',
      heroDescription: clampStr(settings.heroDescription, 600),
      heroImageUrl: clampStr(settings.heroImageUrl, 500),
      footerAddress: clampStr(settings.footerAddress, 200),
      socialLinks: cleanedSocial,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== NEWS ARTICLES ====================

export function subscribeNewsArticles(
  isAdmin: boolean,
  onData: (articles: NewsArticle[]) => void
): Unsubscribe {
  const path = 'news_articles';
  const q = isAdmin
    ? query(collection(db, path))
    : query(collection(db, path), where('isPublished', '==', true));

  return onSnapshot(
    q,
    (snap) => {
      const list: NewsArticle[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const numericId = Number(d.legacyId) || deterministicNumericId(docSnap.id);
        return {
          id: numericId,
          firestoreId: docSnap.id,
          title: String(d.title || ''),
          slug: String(d.slug || docSnap.id),
          category: String(d.category || 'Liputan Sekolah'),
          summary: String(d.summary || ''),
          content: String(d.content || ''),
          image_url: String(d.imageUrl || 'asset:news_liputan'),
          author_name: String(d.authorName || 'Pembina MMC'),
          published_at: String(d.publishedAt || toIsoString(d.createdAt).slice(0, 10)),
          is_featured: d.isFeatured ? 1 : 0,
        };
      });
      list.sort((a, b) => b.published_at.localeCompare(a.published_at));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createNewsInFirestore(input: {
  title: string;
  category: string;
  summary: string;
  content: string;
  authorName: string;
  publishedAt: string;
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google Admin terlebih dahulu.');
  const docId = `news_${Date.now()}`;
  const path = `news_articles/${docId}`;
  try {
    await setDoc(doc(db, 'news_articles', docId), {
      title: clampStr(input.title, 200),
      slug: clampStr(`${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`, 140),
      category: clampStr(input.category || 'Liputan Sekolah', 60),
      summary: clampStr(input.summary, 500),
      content: clampStr(input.content, 6000),
      imageUrl: 'asset:news_liputan',
      authorName: clampStr(input.authorName || 'Pembina MMC', 120),
      publishedAt: clampStr(input.publishedAt, 30),
      isFeatured: false,
      isPublished: true,
      createdByUid: uid,
      createdAt: serverTimestamp(),
    });
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// ==================== SCHEDULES ====================

export function subscribeSchedules(
  isAdmin: boolean,
  onData: (schedules: ScheduleItem[]) => void
): Unsubscribe {
  const path = 'schedules';
  const q = isAdmin
    ? query(collection(db, path))
    : query(collection(db, path), where('isPublished', '==', true));

  return onSnapshot(
    q,
    (snap) => {
      const list: ScheduleItem[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: Number(d.legacyId) || deterministicNumericId(docSnap.id),
          firestoreId: docSnap.id,
          title: String(d.title || ''),
          division: String(d.division || 'Semua Divisi'),
          event_date: String(d.eventDate || ''),
          start_time: String(d.startTime || '15:00'),
          end_time: String(d.endTime || '16:30'),
          location: String(d.location || ''),
          description: String(d.description || ''),
          mentor: String(d.mentor || 'Pembina MMC'),
          reminder_sent: d.reminderSent ? 1 : 0,
        };
      });
      list.sort((a, b) => `${a.event_date} ${a.start_time}`.localeCompare(`${b.event_date} ${b.start_time}`));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createScheduleInFirestore(input: {
  title: string;
  division: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  description: string;
  mentor: string;
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google Admin terlebih dahulu.');
  const docId = `sched_${Date.now()}`;
  const path = `schedules/${docId}`;
  try {
    await setDoc(doc(db, 'schedules', docId), {
      title: clampStr(input.title, 180),
      division: clampStr(input.division || 'Semua Divisi', 60),
      eventDate: clampStr(input.event_date, 20),
      startTime: clampStr(input.start_time, 12),
      endTime: clampStr(input.end_time || '16:30', 12),
      location: clampStr(input.location, 160),
      description: clampStr(input.description, 800),
      mentor: clampStr(input.mentor || 'Pembina MMC', 120),
      reminderSent: true,
      isPublished: true,
      createdByUid: uid,
      createdAt: serverTimestamp(),
    });
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteScheduleInFirestore(firestoreId: string): Promise<void> {
  const path = `schedules/${firestoreId}`;
  try {
    await deleteDoc(doc(db, 'schedules', firestoreId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function remindScheduleInFirestore(firestoreId: string): Promise<void> {
  const path = `schedules/${firestoreId}`;
  try {
    await updateDoc(doc(db, 'schedules', firestoreId), {
      reminderSent: true,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ==================== MEMBERS (PUBLIC + ADMIN PRIVATE) ====================

export function subscribeMembersPublic(
  isAdmin: boolean,
  onData: (members: StudentProfile[]) => void
): Unsubscribe {
  const path = 'members_public';
  const q = isAdmin
    ? query(collection(db, path))
    : query(collection(db, path), where('isVisible', '==', true));

  return onSnapshot(
    q,
    (snap) => {
      const list: StudentProfile[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: Number(d.legacyId) || deterministicNumericId(docSnap.id),
          firestoreId: docSnap.id,
          username: String(d.username || docSnap.id),
          role: d.role === 'admin' ? 'admin' : 'student',
          full_name: String(d.fullName || ''),
          nis: '',
          kelas: String(d.kelas || ''),
          division: String(d.division || ''),
          bio: String(d.bio || ''),
          nfc_uid: '',
          qr_code_token: String(d.qrCodeToken || ''),
          avatar_color: String(d.avatarColor || '#1D4ED8'),
          avatar_url: String(d.avatarUrl || ''),
          show_in_members: d.showInMembers ? 1 : 0,
          auth_hashes: Array.isArray(d.authHashes) ? d.authHashes.map(String) : [],
          created_at: toIsoString(d.createdAt),
          attendance_count: Number(d.attendanceCount || 0),
          works_count: Number(d.worksCount || 0),
          lms_points: Number(d.lmsPoints || 0),
        };
      });
      list.sort((a, b) => {
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        return a.full_name.localeCompare(b.full_name);
      });
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function verifyMemberLoginInFirestore(
  usernameInput: string,
  loginIdInput: string,
  cachedMembers: StudentProfile[] = []
): Promise<StudentProfile> {
  const cleanUser = usernameInput.trim().toLowerCase();
  const cleanId = loginIdInput.trim();
  if (!cleanUser || !cleanId) {
    throw new Error('Username dan ID Login wajib diisi.');
  }

  let candidate = cachedMembers.find((m) => m.username.trim().toLowerCase() === cleanUser) || null;

  if (!candidate) {
    const snap = await getDocs(
      query(collection(db, 'members_public'), where('username', '==', cleanUser))
    );
    const docSnap = snap.docs[0];
    if (docSnap) {
      const d = docSnap.data();
      candidate = {
        id: Number(d.legacyId) || deterministicNumericId(docSnap.id),
        firestoreId: docSnap.id,
        username: String(d.username || docSnap.id),
        role: d.role === 'admin' ? 'admin' : 'student',
        full_name: String(d.fullName || ''),
        nis: '',
        kelas: String(d.kelas || ''),
        division: String(d.division || ''),
        bio: String(d.bio || ''),
        nfc_uid: '',
        qr_code_token: String(d.qrCodeToken || ''),
        avatar_color: String(d.avatarColor || '#1D4ED8'),
        avatar_url: String(d.avatarUrl || ''),
        show_in_members: d.showInMembers ? 1 : 0,
        auth_hashes: Array.isArray(d.authHashes) ? d.authHashes.map(String) : [],
        created_at: toIsoString(d.createdAt),
        attendance_count: Number(d.attendanceCount || 0),
        works_count: Number(d.worksCount || 0),
        lms_points: Number(d.lmsPoints || 0),
      };
    }
  }

  if (!candidate) {
    throw new Error('Username atau ID Login tidak ditemukan.');
  }

  const lowerHash = await sha256Hex(cleanId.toLowerCase());
  const exactHash = await sha256Hex(cleanId);
  const hashes = candidate.auth_hashes || [];

  const matched =
    (Boolean(candidate.qr_code_token) &&
      candidate.qr_code_token.trim().toLowerCase() === cleanId.toLowerCase()) ||
    (Boolean(candidate.nis) && candidate.nis.trim().toLowerCase() === cleanId.toLowerCase()) ||
    hashes.includes(lowerHash) ||
    hashes.includes(exactHash);

  if (!matched) {
    throw new Error('Username atau ID Login tidak sesuai.');
  }

  return candidate;
}

export function subscribeMembersPrivateAdmin(
  onData: (privateMap: Map<string, { nis: string; nfc_uid: string }>) => void
): Unsubscribe {
  const path = 'members_private';
  return onSnapshot(
    collection(db, path),
    (snap) => {
      const map = new Map<string, { nis: string; nfc_uid: string }>();
      for (const docSnap of snap.docs) {
        const d = docSnap.data();
        map.set(docSnap.id, {
          nis: String(d.nis || ''),
          nfc_uid: String(d.nfcUid || ''),
        });
      }
      onData(map);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function saveStudentToFirestore(params: {
  memberId?: string;
  legacyId?: number;
  username: string;
  role?: 'admin' | 'student';
  full_name: string;
  nis: string;
  kelas: string;
  division: string;
  bio: string;
  nfc_uid: string;
  qr_code_token: string;
  avatar_color: string;
  avatar_url?: string;
  show_in_members?: boolean;
  password?: string;
}): Promise<string> {
  const memberId = params.memberId || sanitizeDocId(`member_${params.username.toLowerCase()}`);
  const pubRef = doc(db, 'members_public', memberId);
  const privRef = doc(db, 'members_private', memberId);

  try {
    const existingSnap = await getDoc(pubRef);
    const existingHashes = existingSnap.exists() && Array.isArray(existingSnap.data().authHashes)
      ? (existingSnap.data().authHashes as string[])
      : [];
    const authHashes = await buildMemberAuthHashes({
      qrCodeToken: params.qr_code_token,
      nis: params.nis,
      password: params.password || (!existingSnap.exists() ? (params.role === 'admin' ? 'pembina123' : 'siswa123') : undefined),
      existingHashes,
    });

    const batch = writeBatch(db);
    if (!existingSnap.exists()) {
      batch.set(pubRef, {
        legacyId: params.legacyId ?? Date.now(),
        username: clampStr(params.username.toLowerCase(), 60),
        role: params.role || 'student',
        fullName: clampStr(params.full_name, 120),
        kelas: clampStr(params.kelas, 30),
        division: clampStr(params.division, 40),
        bio: clampStr(params.bio, 400),
        qrCodeToken: clampStr(params.qr_code_token, 60),
        avatarColor: clampStr(params.avatar_color || '#1D4ED8', 16),
        avatarUrl: clampStr(params.avatar_url || '', 500),
        showInMembers: params.show_in_members ?? true,
        isVisible: true,
        ownerUid: '',
        authHashes,
        attendanceCount: 0,
        worksCount: 0,
        lmsPoints: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(pubRef, {
        username: clampStr(params.username.toLowerCase(), 60),
        fullName: clampStr(params.full_name, 120),
        kelas: clampStr(params.kelas, 30),
        division: clampStr(params.division, 40),
        bio: clampStr(params.bio, 400),
        qrCodeToken: clampStr(params.qr_code_token, 60),
        avatarColor: clampStr(params.avatar_color || '#1D4ED8', 16),
        avatarUrl: clampStr(params.avatar_url || '', 500),
        authHashes,
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(privRef, {
      memberId,
      ownerUid: existingSnap.exists() ? String(existingSnap.data().ownerUid || '') : '',
      nis: clampStr(params.nis, 40),
      nfcUid: clampStr(params.nfc_uid.toUpperCase(), 64),
      email: '',
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return memberId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `members_public/${memberId}`);
  }
}

export async function deleteStudentFromFirestore(memberId: string): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'members_private', memberId));
    batch.delete(doc(db, 'members_public', memberId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `members_public/${memberId}`);
  }
}

// ==================== WORKS, LIKES & COMMENTS ====================

export function subscribeWorks(
  isAdmin: boolean,
  onData: (works: StudentWork[]) => void
): Unsubscribe {
  const path = 'works';
  const q = isAdmin
    ? query(collection(db, path))
    : query(collection(db, path), where('approvalStatus', '==', 'approved'));

  return onSnapshot(
    q,
    (snap) => {
      const list: StudentWork[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: Number(d.legacyId) || deterministicNumericId(docSnap.id),
          firestoreId: docSnap.id,
          authorUid: String(d.authorUid || ''),
          user_id: 0,
          title: String(d.title || ''),
          description: String(d.description || ''),
          category: String(d.category || 'Fotografi'),
          media_type: d.mediaType === 'video' ? 'video' : 'image',
          media_url: String(d.mediaUrl || ''),
          shares_count: Number(d.sharesCount || 0),
          comments_disabled: d.commentsDisabled ? 1 : 0,
          approval_status: (d.approvalStatus as StudentWork['approval_status']) || 'approved',
          review_note: String(d.reviewNote || ''),
          created_at: toIsoString(d.createdAt),
          author_name: String(d.authorName || ''),
          author_username: String(d.authorUsername || ''),
          author_kelas: String(d.authorKelas || ''),
          author_division: String(d.authorDivision || ''),
          author_avatar_color: String(d.authorAvatarColor || '#1D4ED8'),
          author_avatar_url: String(d.authorAvatarUrl || ''),
          likes_count: Number(d.likesCount || 0),
          comments_count: Number(d.commentsCount || 0),
          liked_by_me: false,
          comments: [],
        };
      });
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createWorkInFirestore(params: {
  title: string;
  description: string;
  category: string;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  authorName: string;
  authorUsername: string;
  authorKelas: string;
  authorDivision: string;
  authorAvatarColor: string;
  authorAvatarUrl: string;
  isAdminUploader: boolean;
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google terlebih dahulu untuk menyimpan karya ke Cloud.');
  const docId = `work_${Date.now()}`;
  const path = `works/${docId}`;
  try {
    await setDoc(doc(db, 'works', docId), {
      authorUid: uid,
      authorMemberId: sanitizeDocId(`member_${params.authorUsername}`),
      authorName: clampStr(params.authorName, 120),
      authorUsername: clampStr(params.authorUsername, 60),
      authorKelas: clampStr(params.authorKelas, 30),
      authorDivision: clampStr(params.authorDivision, 40),
      authorAvatarColor: clampStr(params.authorAvatarColor || '#1D4ED8', 16),
      authorAvatarUrl: clampStr(params.authorAvatarUrl || '', 500),
      title: clampStr(params.title, 140),
      description: clampStr(params.description, 600),
      category: clampStr(params.category, 60),
      mediaType: params.mediaType,
      mediaUrl: clampStr(params.mediaUrl, 500),
      sharesCount: 0,
      likesCount: 0,
      commentsCount: 0,
      commentsDisabled: false,
      approvalStatus: params.isAdminUploader ? 'approved' : 'pending',
      reviewNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function reviewWorkInFirestore(
  workId: string,
  decision: 'approved' | 'rejected',
  note: string
): Promise<void> {
  const path = `works/${workId}`;
  try {
    await updateDoc(doc(db, 'works', workId), {
      approvalStatus: decision,
      reviewNote: clampStr(note, 300),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteWorkInFirestore(workId: string): Promise<void> {
  const path = `works/${workId}`;
  try {
    await deleteDoc(doc(db, 'works', workId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function toggleWorkLikeInFirestore(workId: string, currentLikesCount: number): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google untuk menyukai karya.');
  const workRef = doc(db, 'works', workId);
  const likeRef = doc(db, 'works', workId, 'likes', uid);
  try {
    const snap = await getDoc(likeRef);
    const batch = writeBatch(db);
    if (snap.exists()) {
      batch.delete(likeRef);
      batch.update(workRef, {
        likesCount: Math.max(0, currentLikesCount - 1),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return false;
    } else {
      batch.set(likeRef, {
        workId,
        userUid: uid,
        createdAt: serverTimestamp(),
      });
      batch.update(workRef, {
        likesCount: currentLikesCount + 1,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return true;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `works/${workId}/likes/${uid}`);
  }
}

export async function addWorkCommentInFirestore(params: {
  workId: string;
  currentCommentsCount: number;
  authorName: string;
  authorUsername: string;
  authorKelas: string;
  authorRole: 'admin' | 'student';
  content: string;
}): Promise<WorkComment> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google untuk mengirim komentar.');
  const commentId = `cmt_${Date.now()}`;
  const workRef = doc(db, 'works', params.workId);
  const commentRef = doc(db, 'works', params.workId, 'comments', commentId);
  try {
    const batch = writeBatch(db);
    batch.set(commentRef, {
      workId: params.workId,
      authorUid: uid,
      authorName: clampStr(params.authorName, 120),
      authorUsername: clampStr(params.authorUsername, 60),
      authorKelas: clampStr(params.authorKelas, 30),
      authorRole: params.authorRole,
      content: clampStr(params.content, 500),
      isHidden: false,
      createdAt: serverTimestamp(),
    });
    batch.update(workRef, {
      commentsCount: params.currentCommentsCount + 1,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return {
      id: Date.now(),
      firestoreId: commentId,
      work_id: 0,
      user_id: 0,
      content: clampStr(params.content, 500),
      is_hidden: 0,
      flagged_reason: null,
      created_at: new Date().toISOString(),
      author_name: params.authorName,
      author_username: params.authorUsername,
      author_kelas: params.authorKelas,
      author_role: params.authorRole,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `works/${params.workId}/comments/${commentId}`);
  }
}

export async function shareWorkInFirestore(workId: string, currentSharesCount: number): Promise<void> {
  if (!auth.currentUser?.uid) return;
  const path = `works/${workId}`;
  try {
    await updateDoc(doc(db, 'works', workId), {
      sharesCount: currentSharesCount + 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function toggleWorkCommentsInFirestore(
  workId: string,
  commentsDisabled: boolean
): Promise<void> {
  const path = `works/${workId}`;
  try {
    await updateDoc(doc(db, 'works', workId), {
      commentsDisabled,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchWorkLikedByUser(workId: string): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, 'works', workId, 'likes', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function deleteWorkCommentInFirestore(
  workId: string,
  commentId: string,
  currentCommentsCount: number
): Promise<void> {
  const workRef = doc(db, 'works', workId);
  const commentRef = doc(db, 'works', workId, 'comments', commentId);
  try {
    const batch = writeBatch(db);
    batch.delete(commentRef);
    batch.update(workRef, {
      commentsCount: Math.max(0, currentCommentsCount - 1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `works/${workId}/comments/${commentId}`);
  }
}

export function subscribeWorkComments(
  workId: string,
  isAdmin: boolean,
  onData: (comments: WorkComment[]) => void
): Unsubscribe {
  const path = `works/${workId}/comments`;
  const q = isAdmin
    ? query(collection(db, 'works', workId, 'comments'))
    : query(collection(db, 'works', workId, 'comments'), where('isHidden', '==', false));

  return onSnapshot(
    q,
    (snap) => {
      const list: WorkComment[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: deterministicNumericId(docSnap.id),
          firestoreId: docSnap.id,
          work_id: deterministicNumericId(workId),
          user_id: 0,
          author_name: String(d.authorName || ''),
          author_username: String(d.authorUsername || ''),
          author_kelas: String(d.authorKelas || ''),
          author_role: d.authorRole === 'admin' ? 'admin' : 'student',
          content: String(d.content || ''),
          is_hidden: d.isHidden ? 1 : 0,
          flagged_reason: null,
          created_at: toIsoString(d.createdAt),
        };
      });
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribePendingWorksAdmin(onData: (works: StudentWork[]) => void): Unsubscribe {
  const path = 'works';
  const q = query(collection(db, path), where('approvalStatus', '==', 'pending'));
  return onSnapshot(
    q,
    (snap) => {
      const list: StudentWork[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: Number(d.legacyId) || deterministicNumericId(docSnap.id),
          firestoreId: docSnap.id,
          authorUid: String(d.authorUid || ''),
          user_id: 0,
          title: String(d.title || ''),
          description: String(d.description || ''),
          category: String(d.category || 'Fotografi'),
          media_type: d.mediaType === 'video' ? 'video' : 'image',
          media_url: String(d.mediaUrl || ''),
          shares_count: Number(d.sharesCount || 0),
          comments_disabled: d.commentsDisabled ? 1 : 0,
          approval_status: 'pending',
          review_note: String(d.reviewNote || ''),
          created_at: toIsoString(d.createdAt),
          author_name: String(d.authorName || ''),
          author_username: String(d.authorUsername || ''),
          author_kelas: String(d.authorKelas || ''),
          author_division: String(d.authorDivision || ''),
          author_avatar_color: String(d.authorAvatarColor || '#1D4ED8'),
          author_avatar_url: String(d.authorAvatarUrl || ''),
          likes_count: Number(d.likesCount || 0),
          comments_count: Number(d.commentsCount || 0),
          liked_by_me: false,
          comments: [],
        };
      });
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

// ==================== ATTENDANCE & LMS TASKS (ADMIN / AUTHENTICATED) ====================

export function subscribeAttendanceRecords(
  isAdmin: boolean,
  uid: string,
  onData: (records: AttendanceRecord[]) => void
): Unsubscribe {
  const path = 'attendance_records';
  const q = isAdmin
    ? query(collection(db, path))
    : query(collection(db, path), where('studentUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list: AttendanceRecord[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: deterministicNumericId(docSnap.id),
          firestoreId: docSnap.id,
          user_id: 0,
          attendance_date: String(d.attendanceDate || ''),
          check_in_time: String(d.checkInTime || ''),
          method: (d.method as AttendanceRecord['method']) || 'NFC/RFID',
          status: (d.status as AttendanceRecord['status']) || 'Hadir',
          session_title: String(d.sessionTitle || ''),
          recorded_by: String(d.recordedBy || ''),
          created_at: toIsoString(d.createdAt),
          full_name: String(d.fullName || ''),
          username: String(d.username || ''),
          nis: '',
          kelas: String(d.kelas || ''),
          division: String(d.division || ''),
          nfc_uid: '',
        };
      });
      list.sort((a, b) => `${b.attendance_date} ${b.check_in_time}`.localeCompare(`${a.attendance_date} ${a.check_in_time}`));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function recordAttendanceInFirestore(params: {
  memberId: string;
  studentUid?: string;
  fullName: string;
  username: string;
  kelas: string;
  division: string;
  attendanceDate: string;
  checkInTime: string;
  method: 'NFC/RFID' | 'QR Scan' | 'Manual Admin';
  status: 'Hadir' | 'Terlambat' | 'Izin';
  sessionTitle: string;
  recordedBy: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google Admin untuk mencatat absensi ke Firebase.');
  const docId = sanitizeDocId(`att_${params.memberId}_${params.attendanceDate}`);
  const ref = doc(db, 'attendance_records', docId);
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        memberId: sanitizeDocId(params.memberId),
        studentUid: clampStr(params.studentUid || '', 128),
        fullName: clampStr(params.fullName, 120),
        username: clampStr(params.username, 60),
        kelas: clampStr(params.kelas, 30),
        division: clampStr(params.division, 40),
        attendanceDate: clampStr(params.attendanceDate, 20),
        checkInTime: clampStr(params.checkInTime, 20),
        method: params.method,
        status: params.status,
        sessionTitle: clampStr(params.sessionTitle, 180),
        recordedBy: clampStr(params.recordedBy, 120),
        recordedByUid: uid,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        checkInTime: clampStr(params.checkInTime, 20),
        method: params.method,
        status: params.status,
        sessionTitle: clampStr(params.sessionTitle, 180),
        recordedBy: clampStr(params.recordedBy, 120),
        recordedByUid: uid,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendance_records/${docId}`);
  }
}

export function subscribeLmsTasks(
  isAdmin: boolean,
  uid: string,
  onData: (tasks: LmsTask[], adminTasks: AdminLmsTask[]) => void
): Unsubscribe {
  const path = 'lms_tasks';
  const q = isAdmin ? query(collection(db, path)) : query(collection(db, path), where('isPublished', '==', true));

  return onSnapshot(
    q,
    async (snap) => {
      try {
        const tasks: LmsTask[] = [];
        const adminTasks: AdminLmsTask[] = [];

        const progressByTask = new Map<string, Array<{ stage_id: number; stageFirestoreId: string; response_text: string; completed_at: string }>>();
        let subSnapDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];

        if (uid) {
          const progressSnap = await getDocs(
            query(collection(db, 'lms_task_progress'), where('userUid', '==', uid))
          );
          for (const p of progressSnap.docs) {
            const pd = p.data();
            const tId = String(pd.taskId || '');
            const arr = progressByTask.get(tId) || [];
            arr.push({
              stage_id: 0,
              stageFirestoreId: String(pd.stageId || ''),
              response_text: String(pd.responseText || ''),
              completed_at: toIsoString(pd.completedAt),
            });
            progressByTask.set(tId, arr);
          }

          const subQuery = isAdmin
            ? query(collection(db, 'lms_task_submissions'))
            : query(collection(db, 'lms_task_submissions'), where('userUid', '==', uid));
          const subSnap = await getDocs(subQuery);
          subSnapDocs = subSnap.docs.map((s) => ({ id: s.id, data: () => s.data() }));
        }

        for (let idx = 0; idx < snap.docs.length; idx++) {
          const docSnap = snap.docs[idx];
          const d = docSnap.data();
          const taskNumId = deterministicNumericId(docSnap.id);
          const stagesSnap = await getDocs(collection(db, 'lms_tasks', docSnap.id, 'stages'));
          const stages: LmsTaskStage[] = stagesSnap.docs
            .map((stDoc, sIdx) => {
              const sd = stDoc.data();
              return {
                id: deterministicNumericId(stDoc.id),
                firestoreId: stDoc.id,
                task_id: taskNumId,
                stage_order: Number(sd.stageOrder || sIdx + 1),
                stage_type: (sd.stageType as 'reading' | 'practice' | 'upload') || 'reading',
                title: String(sd.title || ''),
                content: String(sd.content || ''),
                attachment_url: String(sd.attachmentUrl || ''),
                created_at: toIsoString(sd.createdAt),
              };
            })
            .sort((a, b) => a.stage_order - b.stage_order);

          const taskProgressRaw = progressByTask.get(docSnap.id) || [];
          const mappedProgress = taskProgressRaw.map((p) => {
            const matchedStage = stages.find((s) => s.firestoreId === p.stageFirestoreId);
            return {
              stage_id: matchedStage?.id || 0,
              stageFirestoreId: p.stageFirestoreId,
              response_text: p.response_text,
              completed_at: p.completed_at,
            };
          });

          const taskSubs: AdminLmsSubmission[] = subSnapDocs
            .filter((s) => s.data().taskId === docSnap.id)
            .map((s) => {
              const sd = s.data();
              return {
                id: deterministicNumericId(s.id),
                firestoreId: s.id,
                task_id: taskNumId,
                user_id: 0,
                userUid: String(sd.userUid || ''),
                full_name: String(sd.fullName || ''),
                username: String(sd.username || ''),
                kelas: String(sd.kelas || ''),
                division: String(sd.division || ''),
                nis: '',
                file_url: String(sd.fileUrl || ''),
                file_name: String(sd.fileName || ''),
                file_type: String(sd.fileType || ''),
                submission_note: String(sd.submissionNote || ''),
                status: (sd.status as 'submitted' | 'approved' | 'revision') || 'submitted',
                points_awarded: Number(sd.pointsAwarded || 0),
                admin_feedback: String(sd.adminFeedback || ''),
                submitted_at: toIsoString(sd.submittedAt),
                reviewed_at: sd.reviewedAt ? toIsoString(sd.reviewedAt) : '',
              };
            });

          const mySub = taskSubs.find((s) => s.userUid === uid) || null;
          const baseTask: LmsTask = {
            id: taskNumId,
            firestoreId: docSnap.id,
            title: String(d.title || ''),
            description: String(d.description || ''),
            division: String(d.division || 'Semua'),
            points_reward: Number(d.pointsReward || 100),
            due_date: String(d.dueDate || ''),
            is_published: d.isPublished ? 1 : 0,
            created_by: 0,
            creator_name: String(d.creatorName || 'Pembina MMC'),
            created_at: toIsoString(d.createdAt),
            stages,
            progress: mappedProgress,
            submission: mySub,
          };

          tasks.push(baseTask);
          adminTasks.push({
            ...baseTask,
            submissions: taskSubs,
          });
        }

        tasks.sort((a, b) => b.created_at.localeCompare(a.created_at));
        adminTasks.sort((a, b) => b.created_at.localeCompare(a.created_at));
        onData(tasks, adminTasks);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
      }
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createLmsTaskInFirestore(params: {
  title: string;
  description: string;
  division: string;
  pointsReward: number;
  dueDate: string;
  creatorName: string;
  stages: Array<{
    stage_type: 'reading' | 'practice' | 'upload';
    title: string;
    content: string;
    attachment_url: string;
  }>;
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google Admin untuk menyimpan tugas ke Firebase.');
  const taskId = `task_${Date.now()}`;
  const path = `lms_tasks/${taskId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'lms_tasks', taskId), {
      title: clampStr(params.title, 180),
      description: clampStr(params.description, 1000),
      division: clampStr(params.division || 'Semua', 40),
      pointsReward: Math.max(1, Math.min(10000, Number(params.pointsReward) || 100)),
      dueDate: clampStr(params.dueDate, 30),
      isPublished: true,
      creatorName: clampStr(params.creatorName || 'Pembina MMC', 120),
      createdByUid: uid,
      createdAt: serverTimestamp(),
    });
    params.stages.slice(0, 50).forEach((st, idx) => {
      const stageId = `stage_${idx + 1}_${Date.now()}`;
      batch.set(doc(db, 'lms_tasks', taskId, 'stages', stageId), {
        taskId,
        stageOrder: idx + 1,
        stageType: st.stage_type,
        title: clampStr(st.title, 160),
        content: clampStr(st.content, 4000),
        attachmentUrl: clampStr(st.attachment_url, 500),
        createdAt: serverTimestamp(),
      });
    });
    await batch.commit();
    return taskId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteLmsTaskInFirestore(taskId: string): Promise<void> {
  const path = `lms_tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'lms_tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function completeLmsStageInFirestore(params: {
  taskId: string;
  stageId: string;
  responseText: string;
  memberId?: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const progressId = sanitizeDocId(`${params.taskId}__${params.stageId}__${uid}`);
  const ref = doc(db, 'lms_task_progress', progressId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        taskId: sanitizeDocId(params.taskId),
        stageId: sanitizeDocId(params.stageId),
        userUid: uid,
        memberId: clampStr(params.memberId || '', 128),
        responseText: clampStr(params.responseText, 1000),
        completedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        responseText: clampStr(params.responseText, 1000),
        completedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `lms_task_progress/${progressId}`);
  }
}

export async function submitLmsTaskInFirestore(params: {
  taskId: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  submissionNote: string;
  memberId?: string;
  fullName: string;
  username: string;
  kelas: string;
  division: string;
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google untuk menyimpan pengumpulan tugas ke Firebase.');
  const taskId = sanitizeDocId(params.taskId);
  const subId = sanitizeDocId(`${taskId}__${uid}`);
  const ref = doc(db, 'lms_task_submissions', subId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        taskId,
        userUid: uid,
        memberId: clampStr(params.memberId || '', 128),
        fullName: clampStr(params.fullName, 120),
        username: clampStr(params.username, 60),
        kelas: clampStr(params.kelas, 30),
        division: clampStr(params.division, 40),
        fileUrl: clampStr(params.fileUrl || 'https://mmc-smpn2ciamis.local/submission', 500),
        fileName: clampStr(params.fileName || 'tugas-siswa', 200),
        fileType: clampStr(params.fileType, 120),
        submissionNote: clampStr(params.submissionNote, 1000),
        status: 'submitted',
        pointsAwarded: 0,
        adminFeedback: '',
        submittedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        fileUrl: clampStr(params.fileUrl || String(snap.data().fileUrl || ''), 500),
        fileName: clampStr(params.fileName || String(snap.data().fileName || ''), 200),
        fileType: clampStr(params.fileType, 120),
        submissionNote: clampStr(params.submissionNote, 1000),
        status: 'submitted',
        pointsAwarded: 0,
        submittedAt: serverTimestamp(),
      });
    }
    return subId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `lms_task_submissions/${subId}`);
  }
}

export async function reviewLmsSubmissionInFirestore(params: {
  submissionId: string;
  status: 'approved' | 'revision';
  pointsAwarded: number;
  adminFeedback: string;
}): Promise<void> {
  const path = `lms_task_submissions/${params.submissionId}`;
  try {
    await updateDoc(doc(db, 'lms_task_submissions', params.submissionId), {
      status: params.status,
      pointsAwarded: Math.max(0, Math.min(10000, Number(params.pointsAwarded) || 0)),
      adminFeedback: clampStr(params.adminFeedback, 500),
      reviewedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ==================== BLOCKED WORDS & MEMBER PROFILE SELF-UPDATE ====================

export function subscribeBlockedWords(
  onData: (words: Array<{ id: number; firestoreId: string; word: string }>) => void
): Unsubscribe {
  const path = 'blocked_words';
  return onSnapshot(
    query(collection(db, path)),
    (snap) => {
      const list = snap.docs
        .map((docSnap) => ({
          id: deterministicNumericId(docSnap.id),
          firestoreId: docSnap.id,
          word: String(docSnap.data().word || ''),
        }))
        .sort((a, b) => a.word.localeCompare(b.word));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function addBlockedWordInFirestore(word: string): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Masuk dengan akun Google Admin terlebih dahulu.');
  const docId = sanitizeDocId(`bw_${word.toLowerCase()}`);
  const path = `blocked_words/${docId}`;
  try {
    await setDoc(doc(db, 'blocked_words', docId), {
      word: clampStr(word.toLowerCase(), 80),
      isActive: true,
      createdByUid: uid,
      createdAt: serverTimestamp(),
    });
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteBlockedWordInFirestore(firestoreId: string): Promise<void> {
  const path = `blocked_words/${firestoreId}`;
  try {
    await deleteDoc(doc(db, 'blocked_words', firestoreId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateMemberAvatarInFirestore(
  memberId: string,
  avatarUrl: string
): Promise<void> {
  if (!auth.currentUser?.uid) return;
  const path = `members_public/${memberId}`;
  try {
    await updateDoc(doc(db, 'members_public', memberId), {
      avatarUrl: clampStr(avatarUrl, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ==================== NOTIFICATIONS ====================

export function subscribeNotificationsFirestore(
  isAdmin: boolean,
  uid: string,
  onData: (notifs: NotificationItem[]) => void
): Unsubscribe {
  const path = 'notifications';
  const q = isAdmin
    ? query(collection(db, path))
    : query(collection(db, path), where('targetUid', 'in', [uid, 'ALL']));

  return onSnapshot(
    q,
    (snap) => {
      const list: NotificationItem[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: deterministicNumericId(docSnap.id),
          firestoreId: docSnap.id,
          user_id: d.targetUid === 'ALL' ? null : 0,
          type: (d.type as NotificationItem['type']) || 'moderation',
          title: String(d.title || ''),
          message: String(d.message || ''),
          link_target: d.linkTarget ? String(d.linkTarget) : null,
          is_read: d.isRead ? 1 : 0,
          created_at: toIsoString(d.createdAt),
        };
      });
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

// ==================== INITIAL CLOUD BOOTSTRAP SEED ====================

export async function seedCloudPortalIfEmpty(bootstrapData: {
  siteSettings: SiteBranding;
  news: NewsArticle[];
  schedules: ScheduleItem[];
  members: StudentProfile[];
  works: StudentWork[];
  lmsTasks?: LmsTask[];
}): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;

  try {
    const portalSnap = await getDoc(doc(db, 'site_settings', 'portal'));
    if (portalSnap.exists()) {
      return false; // Already seeded in Cloud Firestore
    }

    const batch = writeBatch(db);

    // 1. Site settings
    const s = bootstrapData.siteSettings;
    const cleanedSocial = (s.socialLinks || []).slice(0, 12).map((item, idx) => ({
      id: clampStr(item.id || `soc_${idx}`, 40) || `soc_${idx}`,
      platform: item.platform || 'website',
      label: clampStr(item.label || item.platform, 40) || 'Sosial',
      url: clampStr(item.url, 300),
      customIconUrl: clampStr(item.customIconUrl, 500),
    }));
    batch.set(doc(db, 'site_settings', 'portal'), {
      brandName: clampStr(s.brandName || 'Multimedia', 60) || 'Multimedia',
      logoUrl: clampStr(s.logoUrl || '', 500),
      heroEyebrow: clampStr(s.heroEyebrow || 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi', 120),
      heroTitle:
        clampStr(
          s.heroTitle || 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis',
          160
        ) || 'Nedacis Media Center',
      heroDescription: clampStr(s.heroDescription || '', 600),
      heroImageUrl: clampStr(s.heroImageUrl || '', 500),
      footerAddress: clampStr(
        s.footerAddress || 'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215',
        200
      ),
      socialLinks: cleanedSocial,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    });

    // 2. Members (public + private) with SHA-256 authHashes for cross-device login
    for (const m of bootstrapData.members) {
      const memberId = sanitizeDocId(`member_${m.username}`);
      const defaultPass = m.role === 'admin' ? 'pembina123' : 'siswa123';
      const authHashes = await buildMemberAuthHashes({
        qrCodeToken: m.qr_code_token || `MMC-${m.id}`,
        nis: m.nis || `NIS-${m.id}`,
        password: defaultPass,
      });
      batch.set(doc(db, 'members_public', memberId), {
        legacyId: m.id,
        username: clampStr(m.username, 60),
        role: m.role,
        fullName: clampStr(m.full_name, 120),
        kelas: clampStr(m.kelas, 30),
        division: clampStr(m.division, 40),
        bio: clampStr(m.bio || '', 400),
        qrCodeToken: clampStr(m.qr_code_token || `MMC-${m.id}`, 60),
        avatarColor: clampStr(m.avatar_color || '#1D4ED8', 16),
        avatarUrl: clampStr(m.avatar_url || '', 500),
        showInMembers: Boolean(m.show_in_members),
        isVisible: true,
        ownerUid: '',
        authHashes,
        attendanceCount: Number(m.attendance_count || 0),
        worksCount: Number(m.works_count || 0),
        lmsPoints: Number(m.lms_points || 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'members_private', memberId), {
        memberId,
        ownerUid: '',
        nis: clampStr(m.nis || `NIS-${m.id}`, 40),
        nfcUid: clampStr(m.nfc_uid || `04MMC${m.id}`, 64),
        email: '',
        updatedAt: serverTimestamp(),
      });
    }

    // 3. News articles
    for (const n of bootstrapData.news) {
      const newsId = sanitizeDocId(`news_${n.id}`);
      batch.set(doc(db, 'news_articles', newsId), {
        title: clampStr(n.title, 200),
        slug: clampStr(n.slug || newsId, 140),
        category: clampStr(n.category, 60),
        summary: clampStr(n.summary, 500),
        content: clampStr(n.content, 6000),
        imageUrl: clampStr(n.image_url || 'asset:news_liputan', 500),
        authorName: clampStr(n.author_name, 120),
        publishedAt: clampStr(n.published_at, 30),
        isFeatured: Boolean(n.is_featured),
        isPublished: true,
        createdByUid: uid,
        createdAt: serverTimestamp(),
      });
    }

    // 4. Schedules
    for (const sc of bootstrapData.schedules) {
      const schedId = sanitizeDocId(`sched_${sc.id}`);
      batch.set(doc(db, 'schedules', schedId), {
        title: clampStr(sc.title, 180),
        division: clampStr(sc.division, 60),
        eventDate: clampStr(sc.event_date, 20),
        startTime: clampStr(sc.start_time, 12),
        endTime: clampStr(sc.end_time, 12),
        location: clampStr(sc.location, 160),
        description: clampStr(sc.description || '', 800),
        mentor: clampStr(sc.mentor, 120),
        reminderSent: Boolean(sc.reminder_sent),
        isPublished: true,
        createdByUid: uid,
        createdAt: serverTimestamp(),
      });
    }

    // 5. Approved Student Works
    for (const w of bootstrapData.works) {
      const workId = sanitizeDocId(`work_${w.id}`);
      batch.set(doc(db, 'works', workId), {
        authorUid: uid,
        authorMemberId: sanitizeDocId(`member_${w.author_username}`),
        authorName: clampStr(w.author_name, 120),
        authorUsername: clampStr(w.author_username, 60),
        authorKelas: clampStr(w.author_kelas || '', 30),
        authorDivision: clampStr(w.author_division || '', 40),
        authorAvatarColor: clampStr(w.author_avatar_color || '#1D4ED8', 16),
        authorAvatarUrl: clampStr(w.author_avatar_url || '', 500),
        title: clampStr(w.title, 140),
        description: clampStr(w.description || '', 600),
        category: clampStr(w.category, 60),
        mediaType: w.media_type,
        mediaUrl: clampStr(w.media_url, 500),
        sharesCount: 0,
        likesCount: 0,
        commentsCount: 0,
        commentsDisabled: Boolean(w.comments_disabled),
        approvalStatus: 'approved',
        reviewNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 6. LMS Tasks & Stages
    for (const t of bootstrapData.lmsTasks || []) {
      const taskId = sanitizeDocId(`task_${t.id}`);
      batch.set(doc(db, 'lms_tasks', taskId), {
        title: clampStr(t.title, 180),
        description: clampStr(t.description || '', 1000),
        division: clampStr(t.division || 'Semua', 40),
        pointsReward: Math.max(1, Math.min(10000, Number(t.points_reward) || 100)),
        dueDate: clampStr(t.due_date || '', 30),
        isPublished: Boolean(t.is_published),
        creatorName: clampStr(t.creator_name || 'Pembina MMC', 120),
        createdByUid: uid,
        createdAt: serverTimestamp(),
      });
      for (const st of t.stages || []) {
        const stageId = sanitizeDocId(`stage_${t.id}_${st.id}`);
        batch.set(doc(db, 'lms_tasks', taskId, 'stages', stageId), {
          taskId,
          stageOrder: Number(st.stage_order) || 1,
          stageType: st.stage_type,
          title: clampStr(st.title, 160),
          content: clampStr(st.content || '', 4000),
          attachmentUrl: clampStr(st.attachment_url || '', 500),
          createdAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'site_settings/portal');
  }
}

export async function syncMemberAuthHashesAdmin(): Promise<void> {
  if (!auth.currentUser?.uid) return;
  try {
    const [pubSnap, privSnap] = await Promise.all([
      getDocs(collection(db, 'members_public')),
      getDocs(collection(db, 'members_private')),
    ]);
    const nisMap = new Map<string, string>();
    for (const p of privSnap.docs) {
      nisMap.set(p.id, String(p.data().nis || ''));
    }

    const batch = writeBatch(db);
    let pendingUpdates = 0;

    for (const mDoc of pubSnap.docs) {
      const d = mDoc.data();
      const existingHashes = Array.isArray(d.authHashes) ? (d.authHashes as string[]) : [];
      if (existingHashes.length > 0) continue;
      const role = d.role === 'admin' ? 'admin' : 'student';
      const username = String(d.username || '');
      const defaultPass = username === 'admin' ? 'adminmmc' : role === 'admin' ? 'pembina123' : 'siswa123';
      const hashes = await buildMemberAuthHashes({
        qrCodeToken: String(d.qrCodeToken || ''),
        nis: nisMap.get(mDoc.id) || '',
        password: defaultPass,
      });
      if (hashes.length > 0) {
        batch.update(doc(db, 'members_public', mDoc.id), {
          authHashes: hashes,
          updatedAt: serverTimestamp(),
        });
        pendingUpdates++;
      }
    }

    if (pendingUpdates > 0) {
      await batch.commit();
    }
  } catch {
    // Non-fatal background sync
  }
}
