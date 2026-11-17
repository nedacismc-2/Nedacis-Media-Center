import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  Calendar,
  ClipboardCheck,
  CreditCard,
  Home,
  Image as ImageIcon,
  LogOut,
  Settings,
  User,
  Users,
} from 'lucide-react';
import type {
  AdminLmsTask,
  AttendanceRecord,
  LmsTask,
  NewsArticle,
  NotificationItem,
  ScheduleItem,
  SiteBranding,
  StudentProfile,
  StudentWork,
  WSEvent,
} from './types';
import { apiFetch, connectRealtimeSocket, getStoredToken, setStoredToken } from './lib/api';
import { useFirebase } from './context/FirebaseContext';
import { subscribeUploadedFilesAdmin, type CloudStorageSummary } from './lib/cloudFiles';
import {
  deterministicNumericId,
  sanitizeDocId,
  seedCloudPortalIfEmpty,
  subscribeAttendanceRecords,
  subscribeBlockedWords,
  subscribeLmsTasks,
  subscribeMembersPrivateAdmin,
  subscribeMembersPublic,
  subscribeNewsArticles,
  subscribeNotificationsFirestore,
  subscribePendingWorksAdmin,
  subscribeSchedules,
  subscribeSiteSettings,
  subscribeWorks,
  syncMemberAuthHashesAdmin,
} from './lib/firestoreSync';

const PORTAL_MEMBER_STORAGE_KEY = 'mmc_portal_member_username';
import { HomeSection } from './components/HomeSection';
import { GallerySection } from './components/GallerySection';
import { MembersSection } from './components/MembersSection';
import { ScheduleSection } from './components/ScheduleSection';
import { AttendanceHub } from './components/AttendanceHub';
import { LmsTasksSection } from './components/LmsTasksSection';
import { LoginModal } from './components/LoginModal';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { AdminSection } from './components/AdminSection';
import { NmcLogo } from './components/NmcLogo';
import { SocialSilhouetteIcon } from './components/SocialSilhouetteIcon';

type MainTab = 'beranda' | 'galeri' | 'anggota' | 'jadwal' | 'tugas' | 'absensi' | 'persetujuan' | 'admin';

interface ToastState {
  id: number;
  message: string;
  variant: 'success' | 'error' | 'info';
}

const DEFAULT_BRANDING: SiteBranding = {
  brandName: 'Multimedia',
  logoUrl: '',
  socialLinks: [
    { id: 'ig', platform: 'instagram', label: 'Instagram', url: 'https://instagram.com' },
    { id: 'tt', platform: 'tiktok', label: 'TikTok', url: 'https://tiktok.com' },
    { id: 'yt', platform: 'youtube', label: 'YouTube', url: 'https://youtube.com' },
  ],
};

export default function App() {
  const { firebaseUser, firebaseAuthReady, isFirebaseAdmin, cloudPhotoUrl, signOutGoogle } = useFirebase();

  const [activeTab, setActiveTab] = useState<MainTab>('beranda');
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [selectedWork, setSelectedWork] = useState<StudentWork | null>(null);

  const [currentUser, setCurrentUser] = useState<StudentProfile | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());

  // Local SQLite bootstrap state (fallback before initial cloud seed)
  const [localNews, setLocalNews] = useState<NewsArticle[]>([]);
  const [localSchedules, setLocalSchedules] = useState<ScheduleItem[]>([]);
  const [localMembers, setLocalMembers] = useState<StudentProfile[]>([]);
  const [localWorks, setLocalWorks] = useState<StudentWork[]>([]);
  const [localAttendance, setLocalAttendance] = useState<AttendanceRecord[]>([]);
  const [localLmsTasks, setLocalLmsTasks] = useState<LmsTask[]>([]);
  const [localNotifications, setLocalNotifications] = useState<NotificationItem[]>([]);
  const [localBranding, setLocalBranding] = useState<SiteBranding>(DEFAULT_BRANDING);
  const [localPendingWorksCount, setLocalPendingWorksCount] = useState(0);

  // Cloud Firestore real-time state (authoritative across browsers/devices once seeded)
  const [cloudSeeded, setCloudSeeded] = useState(false);
  const [cloudBranding, setCloudBranding] = useState<SiteBranding | null>(null);
  const [cloudNews, setCloudNews] = useState<NewsArticle[] | null>(null);
  const [cloudSchedules, setCloudSchedules] = useState<ScheduleItem[] | null>(null);
  const [cloudPublicMembers, setCloudPublicMembers] = useState<StudentProfile[] | null>(null);
  const [privateMembersMap, setPrivateMembersMap] = useState<Map<string, { nis: string; nfc_uid: string }>>(
    () => new Map()
  );
  const [cloudWorks, setCloudWorks] = useState<StudentWork[] | null>(null);
  const [cloudAttendance, setCloudAttendance] = useState<AttendanceRecord[] | null>(null);
  const [cloudLmsTasks, setCloudLmsTasks] = useState<LmsTask[] | null>(null);
  const [cloudAdminTasks, setCloudAdminTasks] = useState<AdminLmsTask[] | undefined>(undefined);
  const [cloudPendingWorks, setCloudPendingWorks] = useState<StudentWork[] | undefined>(undefined);
  const [cloudBlockedWords, setCloudBlockedWords] = useState<
    Array<{ id: number; firestoreId?: string; word: string }> | undefined
  >(undefined);
  const [cloudNotifications, setCloudNotifications] = useState<NotificationItem[] | null>(null);
  const [cloudStorageSummary, setCloudStorageSummary] = useState<CloudStorageSummary | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [latestAttendanceEvent, setLatestAttendanceEvent] = useState<AttendanceRecord | null>(null);

  const [loginOpen, setLoginOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [pendingRefreshKey, setPendingRefreshKey] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);

  const bootstrapRef = useRef<{
    siteSettings: SiteBranding;
    news: NewsArticle[];
    schedules: ScheduleItem[];
    members: StudentProfile[];
    works: StudentWork[];
    lmsTasks?: LmsTask[];
  } | null>(null);
  const autoSeedAttemptedRef = useRef(false);
  const lastStorageAlertStatusRef = useRef<'ok' | 'warning' | 'full'>('ok');
  const [bootstrapReady, setBootstrapReady] = useState(false);

  const showToast = useCallback((message: string, variant: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToast({ id, message, variant });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 4200);
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await apiFetch<{
        user: StudentProfile | null;
        news: NewsArticle[];
        schedules: ScheduleItem[];
        members: StudentProfile[];
        works: StudentWork[];
        attendance: AttendanceRecord[];
        lmsTasks?: LmsTask[];
        siteSettings?: SiteBranding;
      }>('/api/bootstrap');

      bootstrapRef.current = {
        siteSettings: data.siteSettings || DEFAULT_BRANDING,
        news: data.news,
        schedules: data.schedules,
        members: data.members,
        works: data.works,
        lmsTasks: data.lmsTasks,
      };
      setBootstrapReady(true);

      if (data.user) {
        setCurrentUser(data.user);
      } else if (!localStorage.getItem(PORTAL_MEMBER_STORAGE_KEY)) {
        setCurrentUser(null);
      }
      setLocalNews(data.news);
      setLocalSchedules(data.schedules);
      setLocalMembers(data.members);
      setLocalWorks(data.works);
      setLocalAttendance(data.attendance);
      setLocalLmsTasks(data.lmsTasks || []);
      if (data.siteSettings) {
        setLocalBranding(data.siteSettings);
      }
      if (!data.user && getStoredToken()) {
        setStoredToken(null);
        setToken(null);
      }
    } catch {
      // ignore if backend unavailable; Firestore listeners handle cloud state
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLmsTasks = useCallback(async () => {
    if (!getStoredToken()) {
      setLocalLmsTasks([]);
      return;
    }
    try {
      const res = await apiFetch<{ tasks: LmsTask[]; totalPoints: number }>('/api/tasks');
      setLocalLmsTasks(res.tasks);
      setCurrentUser((prev) => (prev ? { ...prev, lms_points: res.totalPoints } : prev));
    } catch {
      // ignore
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!getStoredToken()) {
      setLocalNotifications([]);
      return;
    }
    try {
      const res = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications');
      setLocalNotifications(res.notifications);
    } catch {
      setLocalNotifications([]);
    }
  }, []);

  const loadPendingCount = useCallback(async () => {
    if (!getStoredToken()) {
      setLocalPendingWorksCount(0);
      return;
    }
    try {
      const res = await apiFetch<{ works: StudentWork[] }>('/api/admin/works/pending');
      setLocalPendingWorksCount(res.works.length);
    } catch {
      setLocalPendingWorksCount(0);
    }
  }, []);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (currentUser) {
      loadNotifications();
      if (currentUser.role === 'admin') {
        loadPendingCount();
      } else {
        setLocalPendingWorksCount(0);
      }
    } else {
      setLocalNotifications([]);
      setLocalPendingWorksCount(0);
    }
  }, [currentUser, loadNotifications, loadPendingCount]);

  const handleSyncCloudNow = useCallback(async () => {
    if (!isFirebaseAdmin) {
      showToast('Masuk dengan akun Google Admin (NedacisMC@gmail.com) untuk sinkronisasi awal cloud.', 'error');
      return;
    }
    const payload = bootstrapRef.current || {
      siteSettings: localBranding,
      news: localNews,
      schedules: localSchedules,
      members: localMembers,
      works: localWorks,
      lmsTasks: localLmsTasks,
    };
    const didSeed = await seedCloudPortalIfEmpty(payload);
    if (didSeed) {
      setCloudSeeded(true);
      showToast('Data awal portal berhasil diunggah ke Cloud Firestore.', 'success');
    } else {
      showToast('Cloud Firestore sudah aktif dan tersinkronisasi real-time di semua perangkat.', 'info');
    }
  }, [isFirebaseAdmin, localBranding, localNews, localSchedules, localMembers, localWorks, localLmsTasks, showToast]);

  // Merged effective data (Cloud Firestore overrides local bootstrap once seeded)
  const siteBranding = cloudBranding ?? localBranding;
  const news = cloudSeeded && cloudNews !== null ? cloudNews : localNews;
  const schedules = cloudSeeded && cloudSchedules !== null ? cloudSchedules : localSchedules;
  const works = cloudSeeded && cloudWorks !== null ? cloudWorks : localWorks;

  const rawMembers = cloudSeeded && cloudPublicMembers !== null ? cloudPublicMembers : localMembers;
  const members = useMemo(() => {
    if (privateMembersMap.size === 0) return rawMembers;
    return rawMembers.map((m) => {
      const key = m.firestoreId || sanitizeDocId(`member_${m.username}`);
      const priv = privateMembersMap.get(key);
      if (!priv) return m;
      return {
        ...m,
        nis: priv.nis || m.nis,
        nfc_uid: priv.nfc_uid || m.nfc_uid,
      };
    });
  }, [rawMembers, privateMembersMap]);

  // Resolve member identity cleanly for both Username+ID sessions and Google Auth sessions
  const resolvedMember = useMemo(() => {
    if (currentUser) return currentUser;
    if (!firebaseUser) return null;
    const emailPrefix = (firebaseUser.email?.split('@')[0] || 'pengguna')
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '_');
    return (
      members.find(
        (m) =>
          (isFirebaseAdmin && m.role === 'admin' && m.show_in_members === 0) ||
          m.username.toLowerCase() === emailPrefix
      ) || null
    );
  }, [currentUser, firebaseUser, isFirebaseAdmin, members]);

  const effectiveMemberDocId = useMemo(() => {
    if (resolvedMember?.firestoreId?.startsWith('member_')) {
      return resolvedMember.firestoreId;
    }
    if (resolvedMember?.username) {
      return sanitizeDocId(`member_${resolvedMember.username}`);
    }
    return '';
  }, [resolvedMember]);

  const effectiveIsAdmin = resolvedMember?.role === 'admin' || isFirebaseAdmin;

  const attendanceRecords =
    (firebaseUser || currentUser) && cloudAttendance !== null ? cloudAttendance : localAttendance;
  const lmsTasks =
    (firebaseUser || currentUser) && cloudLmsTasks !== null ? cloudLmsTasks : localLmsTasks;
  const notifications =
    (firebaseUser || currentUser) && cloudNotifications !== null ? cloudNotifications : localNotifications;
  const pendingWorksCount =
    effectiveIsAdmin && cloudPendingWorks !== undefined ? cloudPendingWorks.length : localPendingWorksCount;

  // Restore saved cross-device member login from localStorage once cloud members load
  useEffect(() => {
    if (currentUser) return;
    const savedUsername = localStorage.getItem(PORTAL_MEMBER_STORAGE_KEY);
    if (!savedUsername || members.length === 0) return;
    const restored = members.find(
      (m) => m.username.trim().toLowerCase() === savedUsername.trim().toLowerCase()
    );
    if (restored) {
      setCurrentUser(restored);
    }
  }, [currentUser, members]);

  // Public Cloud Firestore real-time subscriptions (syncs across all devices/browsers)
  useEffect(() => {
    const unsubSettings = subscribeSiteSettings((settings) => {
      if (settings) {
        setCloudSeeded(true);
        setCloudBranding(settings);
        setLoading(false);
      } else {
        setCloudSeeded(false);
        setCloudBranding(null);
      }
    });

    const unsubNews = subscribeNewsArticles(effectiveIsAdmin, (articles) => {
      setCloudNews(articles);
    });

    const unsubSchedules = subscribeSchedules(effectiveIsAdmin, (scheds) => {
      setCloudSchedules(scheds);
    });

    const unsubMembers = subscribeMembersPublic(effectiveIsAdmin, (memList) => {
      setCloudPublicMembers(memList);
    });

    const unsubWorks = subscribeWorks(effectiveIsAdmin, (workList) => {
      setCloudWorks(workList);
    });

    return () => {
      unsubSettings();
      unsubNews();
      unsubSchedules();
      unsubMembers();
      unsubWorks();
    };
  }, [effectiveIsAdmin]);

  // Student, Pembina, and Google Auth real-time Cloud Firestore listeners (without requiring Google Sign-In)
  useEffect(() => {
    if (firebaseUser?.uid || effectiveMemberDocId) {
      const uid = firebaseUser?.uid || '';
      const unsubAtt = subscribeAttendanceRecords(
        effectiveIsAdmin,
        uid,
        (records) => {
          setCloudAttendance(records);
        },
        effectiveMemberDocId
      );

      const unsubLms = subscribeLmsTasks(
        effectiveIsAdmin,
        uid,
        (tasks, adminTasks) => {
          setCloudLmsTasks(tasks);
          setCloudAdminTasks(effectiveIsAdmin ? adminTasks : undefined);
        },
        effectiveMemberDocId
      );

      const unsubNotifs = subscribeNotificationsFirestore(
        effectiveIsAdmin,
        uid,
        (notifs) => {
          setCloudNotifications(notifs);
        },
        effectiveMemberDocId
      );

      return () => {
        unsubAtt();
        unsubLms();
        unsubNotifs();
      };
    }

    setCloudAttendance(null);
    setCloudAdminTasks(undefined);
    setCloudNotifications(null);
    setCloudLmsTasks(null);
    return undefined;
  }, [firebaseUser?.uid, effectiveIsAdmin, effectiveMemberDocId]);

  // Admin & Pembina Cloud Firestore listeners (Pending Works, Blocked Words, Storage Monitor, and PII when Google Admin)
  useEffect(() => {
    if (!effectiveIsAdmin) {
      setPrivateMembersMap(new Map());
      setCloudPendingWorks(undefined);
      setCloudBlockedWords(undefined);
      setCloudStorageSummary(null);
      lastStorageAlertStatusRef.current = 'ok';
      return;
    }

    const unsubs: Array<() => void> = [];

    if (firebaseUser?.uid && isFirebaseAdmin) {
      unsubs.push(
        subscribeMembersPrivateAdmin((map) => {
          setPrivateMembersMap(map);
        })
      );
    } else {
      setPrivateMembersMap(new Map());
    }

    unsubs.push(
      subscribePendingWorksAdmin((pendingList) => {
        setCloudPendingWorks(pendingList);
      })
    );

    unsubs.push(
      subscribeBlockedWords((words) => {
        setCloudBlockedWords(words);
      })
    );

    unsubs.push(
      subscribeUploadedFilesAdmin((summary) => {
        setCloudStorageSummary(summary);
        if (summary.status !== lastStorageAlertStatusRef.current) {
          lastStorageAlertStatusRef.current = summary.status;
          if (summary.status === 'full') {
            showToast(
              `Penyimpanan Cloud Firebase penuh (${summary.usagePercent}%). Hapus file lama di Panel Admin > Database & Penyimpanan.`,
              'error'
            );
          } else if (summary.status === 'warning') {
            showToast(
              `Penyimpanan Cloud Firebase hampir penuh (${summary.usagePercent}%). Kelola file di Panel Admin > Database & Penyimpanan.`,
              'info'
            );
          }
        }
      })
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser?.uid, isFirebaseAdmin, effectiveIsAdmin, showToast]);

  // Auto-seed Cloud Firestore & ensure cross-device member auth hashes when Admin signs in with Google
  useEffect(() => {
    if (!firebaseAuthReady || !isFirebaseAdmin) return;
    if (cloudSeeded) {
      syncMemberAuthHashesAdmin().catch(() => {});
      return;
    }
    if (!bootstrapReady || !bootstrapRef.current) {
      return;
    }
    if (autoSeedAttemptedRef.current) return;
    autoSeedAttemptedRef.current = true;

    seedCloudPortalIfEmpty(bootstrapRef.current)
      .then((didSeed) => {
        if (didSeed) {
          setCloudSeeded(true);
          showToast('Database Cloud Firestore berhasil diinisialisasi & disinkronkan!', 'success');
        }
      })
      .catch(() => {
        autoSeedAttemptedRef.current = false;
      });
  }, [firebaseAuthReady, isFirebaseAdmin, cloudSeeded, bootstrapReady, showToast]);

  // Synthesize effectiveUser from local/portal session OR authenticated Firebase Google session
  const effectiveUser = useMemo<StudentProfile | null>(() => {
    const cloudPoints = lmsTasks.reduce(
      (sum, t) => sum + (t.submission?.status === 'approved' ? t.submission.points_awarded || 0 : 0),
      0
    );
    if (currentUser) {
      return {
        ...currentUser,
        role: isFirebaseAdmin ? 'admin' : currentUser.role,
        avatar_url:
          currentUser.avatar_url ||
          (cloudPhotoUrl.startsWith('cloudfile://') || cloudPhotoUrl.startsWith('/uploads/')
            ? cloudPhotoUrl
            : '') ||
          '',
        lms_points: (firebaseUser || currentUser) && cloudLmsTasks !== null ? cloudPoints : currentUser.lms_points,
      };
    }
    if (firebaseUser) {
      const emailPrefix = (firebaseUser.email?.split('@')[0] || 'pengguna')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '_');
      if (resolvedMember) {
        return {
          ...resolvedMember,
          role: isFirebaseAdmin ? 'admin' : resolvedMember.role,
          avatar_url: resolvedMember.avatar_url || cloudPhotoUrl || firebaseUser.photoURL || '',
          lms_points: cloudLmsTasks !== null ? cloudPoints : resolvedMember.lms_points,
        };
      }
      return {
        id: deterministicNumericId(firebaseUser.uid),
        firestoreId: sanitizeDocId(`user_${firebaseUser.uid}`),
        username: emailPrefix,
        role: isFirebaseAdmin ? 'admin' : 'student',
        full_name: firebaseUser.displayName || firebaseUser.email || 'Pengguna Google',
        nis: '',
        kelas: isFirebaseAdmin ? 'Pembina' : 'Anggota',
        division: isFirebaseAdmin ? 'Pembina' : 'Fotografi',
        bio: 'Akun terhubung ke Cloud Firestore.',
        nfc_uid: '',
        qr_code_token: `NMC-FB-${firebaseUser.uid.slice(0, 8).toUpperCase()}`,
        avatar_color: isFirebaseAdmin ? '#B91C1C' : '#1D4ED8',
        avatar_url: cloudPhotoUrl || firebaseUser.photoURL || '',
        show_in_members: 0,
        created_at: new Date().toISOString(),
        lms_points: cloudPoints,
      };
    }
    return null;
  }, [currentUser, firebaseUser, isFirebaseAdmin, cloudPhotoUrl, resolvedMember, lmsTasks, cloudLmsTasks]);

  // Hash routing for QR Code profile deep-linking (#profil/username)
  useEffect(() => {
    const applyHashRoute = () => {
      const hash = window.location.hash;
      const profileMatch = hash.match(/^#profil\/([a-zA-Z0-9._-]+)$/);
      if (profileMatch) {
        setActiveTab('anggota');
        setSelectedUsername(profileMatch[1]);
      }
    };
    applyHashRoute();
    window.addEventListener('hashchange', applyHashRoute);
    return () => window.removeEventListener('hashchange', applyHashRoute);
  }, []);

  // Real-time WebSocket event handling (local Express fallback)
  useEffect(() => {
    const cleanup = connectRealtimeSocket(
      token,
      (event: WSEvent) => {
        if (event.type === 'attendance:recorded') {
          const rec = event.payload;
          setLatestAttendanceEvent(rec);
          setLocalAttendance((prev) => {
            const existsIdx = prev.findIndex(
              (r) => r.user_id === rec.user_id && r.attendance_date === rec.attendance_date
            );
            if (existsIdx >= 0) {
              return prev.map((r, i) => (i === existsIdx ? rec : r));
            }
            return [rec, ...prev];
          });
          setLocalMembers((prev) =>
            prev.map((m) =>
              m.id === rec.user_id ? { ...m, attendance_count: (m.attendance_count ?? 0) + 1 } : m
            )
          );
        } else if (event.type === 'notification:new') {
          const notif = event.payload;
          setLocalNotifications((prev) => {
            if (prev.some((n) => n.id === notif.id)) return prev;
            return [notif, ...prev];
          });
          if (currentUser && (notif.user_id === null || notif.user_id === currentUser.id)) {
            showToast(`${notif.title}: ${notif.message}`, 'info');
          }
          if (currentUser?.role === 'admin' && notif.type === 'moderation') {
            setPendingRefreshKey((k) => k + 1);
            loadPendingCount();
          }
        } else if (event.type === 'work:created') {
          const work = event.payload;
          setLocalWorks((prev) => (prev.some((w) => w.id === work.id) ? prev : [work, ...prev]));
          setPendingRefreshKey((k) => k + 1);
        } else if (event.type === 'work:deleted') {
          const { id } = event.payload;
          setLocalWorks((prev) => prev.filter((w) => w.id !== id));
          setSelectedWork((prev) => (prev?.id === id ? null : prev));
          setPendingRefreshKey((k) => k + 1);
        } else if (event.type === 'work:updated') {
          const patch = event.payload;
          setLocalWorks((prev) => prev.map((w) => (w.id === patch.id ? { ...w, ...patch } : w)));
          setSelectedWork((prev) => (prev?.id === patch.id ? { ...prev, ...patch } : prev));
        } else if (event.type === 'comment:created') {
          const c = event.payload;
          setLocalWorks((prev) =>
            prev.map((w) => {
              if (w.id !== c.work_id) return w;
              const existing = w.comments || [];
              if (existing.some((x) => x.id === c.id)) return w;
              return { ...w, comments: [...existing, c] };
            })
          );
          setSelectedWork((prev) => {
            if (!prev || prev.id !== c.work_id) return prev;
            const existing = prev.comments || [];
            if (existing.some((x) => x.id === c.id)) return prev;
            return { ...prev, comments: [...existing, c] };
          });
        } else if (event.type === 'comment:deleted') {
          const { id, work_id } = event.payload;
          setLocalWorks((prev) =>
            prev.map((w) =>
              w.id === work_id ? { ...w, comments: (w.comments || []).filter((c) => c.id !== id) } : w
            )
          );
          setSelectedWork((prev) =>
            prev && prev.id === work_id
              ? { ...prev, comments: (prev.comments || []).filter((c) => c.id !== id) }
              : prev
          );
        } else if (event.type === 'schedule:created') {
          const sched = event.payload;
          setLocalSchedules((prev) => (prev.some((s) => s.id === sched.id) ? prev : [...prev, sched]));
        } else if (event.type === 'settings:updated') {
          setLocalBranding(event.payload);
        } else if (event.type === 'member:updated') {
          const { id, avatar_url } = event.payload;
          setLocalMembers((prev) => prev.map((m) => (m.id === id ? { ...m, avatar_url } : m)));
          setLocalWorks((prev) =>
            prev.map((w) => (w.user_id === id ? { ...w, author_avatar_url: avatar_url } : w))
          );
          setCurrentUser((prev) => (prev && prev.id === id ? { ...prev, avatar_url } : prev));
        } else if (event.type === 'member:points_updated') {
          const { id, lms_points } = event.payload;
          setLocalMembers((prev) => prev.map((m) => (m.id === id ? { ...m, lms_points } : m)));
          setCurrentUser((prev) => (prev && prev.id === id ? { ...prev, lms_points } : prev));
        } else if (
          event.type === 'task:created' ||
          event.type === 'task:deleted' ||
          event.type === 'task:reviewed'
        ) {
          if (currentUser) {
            loadLmsTasks();
          }
        }
      },
      setWsConnected
    );
    return cleanup;
  }, [token, currentUser, showToast, loadLmsTasks, loadPendingCount]);

  const isAdminOnlyTab = (t: MainTab) => t === 'absensi' || t === 'persetujuan' || t === 'admin';

  useEffect(() => {
    if (!loading && firebaseAuthReady && isAdminOnlyTab(activeTab) && !effectiveIsAdmin) {
      setActiveTab('beranda');
    }
    if (!loading && firebaseAuthReady && activeTab === 'tugas' && !effectiveUser) {
      setActiveTab('beranda');
    }
  }, [activeTab, effectiveIsAdmin, effectiveUser, loading, firebaseAuthReady]);

  const navigateTab = (tab: MainTab) => {
    if (isAdminOnlyTab(tab) && !effectiveIsAdmin) {
      showToast('Menu ini hanya dapat diakses oleh Pembina / Admin.', 'error');
      return;
    }
    if (tab === 'tugas' && !effectiveUser) {
      setLoginOpen(true);
      showToast('Silakan masuk akun terlebih dahulu untuk mengakses Tugas LMS.', 'info');
      return;
    }
    setActiveTab(tab);
    if (tab !== 'anggota') {
      setSelectedUsername(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openMemberProfile = (username: string) => {
    setActiveTab('anggota');
    setSelectedUsername(username);
    window.location.hash = `profil/${username}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    await signOutGoogle().catch(() => {});
    localStorage.removeItem(PORTAL_MEMBER_STORAGE_KEY);
    setStoredToken(null);
    setToken(null);
    setCurrentUser(null);
    setLocalAttendance([]);
    setLocalLmsTasks([]);
    setLocalNotifications([]);
    setLocalPendingWorksCount(0);
    if (isAdminOnlyTab(activeTab) || activeTab === 'tugas') {
      setActiveTab('beranda');
    }
    showToast('Anda telah keluar dari akun.', 'info');
  };

  const handleMarkAllRead = async () => {
    await apiFetch('/api/notifications/read', { method: 'POST' }).catch(() => {});
    setLocalNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    setCloudNotifications((prev) => (prev ? prev.map((n) => ({ ...n, is_read: 1 })) : prev));
  };

  const unreadCount = notifications.filter((n) => n.is_read === 0).length;
  const pendingTasksCount = lmsTasks.filter(
    (t) => !t.submission || t.submission.status === 'revision'
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900 pb-20 md:pb-0">
      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 bg-[#B91C1C] text-white border-b-2 border-[#FACC15] no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-8">
          {/* Zone 1: NMC Logo & Wordmark */}
          <button
            type="button"
            onClick={() => navigateTab('beranda')}
            className="inline-flex items-center gap-2.5 text-white whitespace-nowrap shrink-0 text-left"
          >
            <NmcLogo logoUrl={siteBranding.logoUrl} brandName={siteBranding.brandName} />
          </button>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-medium text-white/85">
            {(
              [
                ['beranda', 'Beranda'],
                ['galeri', 'Galeri'],
                ['anggota', 'Anggota'],
                ['jadwal', 'Jadwal'],
                ...(effectiveUser
                  ? ([
                      [
                        'tugas',
                        pendingTasksCount > 0 ? `Tugas (${pendingTasksCount})` : 'Tugas',
                      ],
                    ] as const)
                  : []),
                ...(effectiveIsAdmin
                  ? ([
                      ['absensi', 'Absensi'],
                      [
                        'persetujuan',
                        pendingWorksCount > 0 ? `Persetujuan (${pendingWorksCount})` : 'Persetujuan',
                      ],
                      ['admin', 'Panel Admin'],
                    ] as const)
                  : []),
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => navigateTab(id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeTab === id
                    ? 'text-[#FACC15] border-[#FACC15]'
                    : 'border-transparent hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            {effectiveUser ? (
              <>
                <button
                  type="button"
                  onClick={() => setNotifOpen(true)}
                  aria-label="Notifikasi"
                  className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-white/90 hover:bg-white/15 hover:text-white transition-colors"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#FACC15]" />
                  )}
                </button>

                {effectiveIsAdmin ? (
                  <button
                    type="button"
                    onClick={() => navigateTab('admin')}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-colors min-h-[40px] whitespace-nowrap ${
                      activeTab === 'admin'
                        ? 'bg-white text-[#B91C1C]'
                        : 'text-amber-950 bg-[#FACC15] hover:bg-[#FDE047]'
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline">Admin</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openMemberProfile(effectiveUser.username)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-amber-950 bg-[#FACC15] hover:bg-[#FDE047] rounded-xl transition-colors min-h-[40px] whitespace-nowrap max-w-[150px]"
                  >
                    <User className="w-4 h-4 shrink-0" />
                    <span className="truncate">{effectiveUser.full_name.split(' ')[0]}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleLogout}
                  title="Keluar"
                  aria-label="Keluar"
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-white/85 hover:bg-white/15 hover:text-white transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="px-4 py-2 text-xs sm:text-sm font-semibold text-amber-950 bg-[#FACC15] hover:bg-[#FDE047] rounded-xl transition-colors min-h-[40px] whitespace-nowrap shrink-0"
              >
                Masuk Akun
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-sm text-slate-500">
            Memuat portal Nedacis Media Center SMPN 2 Ciamis...
          </div>
        ) : (
          <>
            {activeTab === 'beranda' && (
              <HomeSection
                news={news}
                schedules={schedules}
                works={works}
                memberCount={members.filter((m) => m.role === 'student').length}
                siteBranding={siteBranding}
                currentUser={effectiveUser}
                lmsTasks={lmsTasks}
                isAdmin={effectiveIsAdmin}
                onNavigate={navigateTab}
                onOpenWork={(w) => {
                  setActiveTab('galeri');
                  setSelectedWork(w);
                }}
              />
            )}

            {activeTab === 'galeri' && (
              <GallerySection
                works={works}
                currentUser={effectiveUser}
                selectedWork={selectedWork}
                onSelectWork={setSelectedWork}
                onOpenMemberProfile={openMemberProfile}
                onRequireLogin={() => setLoginOpen(true)}
                onWorkCreated={(w) =>
                  setLocalWorks((prev) => (prev.some((x) => x.id === w.id) ? prev : [w, ...prev]))
                }
                onWorkDeleted={(id) => setLocalWorks((prev) => prev.filter((x) => x.id !== id))}
                onWorkPatch={(id, patch) => {
                  setLocalWorks((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
                  setSelectedWork((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
                }}
                onToast={showToast}
              />
            )}

            {activeTab === 'anggota' && (
              <MembersSection
                members={members}
                allWorks={works}
                allAttendance={attendanceRecords}
                currentUser={effectiveUser}
                lmsTasks={lmsTasks}
                selectedUsername={selectedUsername}
                onSelectUsername={(uname) => {
                  setSelectedUsername(uname);
                  if (!uname && window.location.hash.startsWith('#profil/')) {
                    history.replaceState(null, '', window.location.pathname);
                  }
                }}
                onOpenWork={(w) => {
                  setActiveTab('galeri');
                  setSelectedWork(w);
                }}
                onOpenTasks={(taskId) => {
                  if (taskId) setSelectedTaskId(taskId);
                  navigateTab('tugas');
                }}
                onUserUpdated={(updatedUser) => {
                  setCurrentUser(updatedUser);
                  setLocalMembers((prev) =>
                    prev.map((m) => (m.id === updatedUser.id ? { ...m, avatar_url: updatedUser.avatar_url } : m))
                  );
                }}
                onWorkApprovedOrAdminCreated={(w) =>
                  setLocalWorks((prev) => (prev.some((x) => x.id === w.id) ? prev : [w, ...prev]))
                }
                onToast={showToast}
                latestAttendanceEvent={latestAttendanceEvent}
              />
            )}

            {activeTab === 'jadwal' && (
              <ScheduleSection
                schedules={schedules}
                currentUser={effectiveUser}
                onScheduleAdded={(s) =>
                  setLocalSchedules((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]))
                }
                onScheduleDeleted={(id) => setLocalSchedules((prev) => prev.filter((s) => s.id !== id))}
                onToast={showToast}
              />
            )}

            {activeTab === 'tugas' && effectiveUser && (
              <LmsTasksSection
                currentUser={effectiveUser}
                tasks={lmsTasks}
                initialSelectedTaskId={selectedTaskId}
                onTaskUpdated={(updatedTask, newTotalPoints) => {
                  setLocalLmsTasks((prev) =>
                    prev.map((t) => (t.id === updatedTask.id ? updatedTask : t))
                  );
                  setCloudLmsTasks((prev) =>
                    prev ? prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)) : prev
                  );
                  if (newTotalPoints !== undefined) {
                    setCurrentUser((prev) => (prev ? { ...prev, lms_points: newTotalPoints } : prev));
                    setLocalMembers((prev) =>
                      prev.map((m) =>
                        m.id === effectiveUser.id ? { ...m, lms_points: newTotalPoints } : m
                      )
                    );
                  }
                }}
                onToast={showToast}
              />
            )}

            {activeTab === 'absensi' && effectiveIsAdmin && (
              <AttendanceHub
                members={members}
                attendanceRecords={attendanceRecords}
                currentUser={effectiveUser}
                wsConnected={wsConnected || Boolean(firebaseUser || currentUser)}
                onAttendanceRecorded={(rec) => {
                  setLatestAttendanceEvent(rec);
                  setLocalAttendance((prev) => {
                    const idx = prev.findIndex(
                      (r) => r.user_id === rec.user_id && r.attendance_date === rec.attendance_date
                    );
                    if (idx >= 0) return prev.map((r, i) => (i === idx ? rec : r));
                    return [rec, ...prev];
                  });
                }}
                onOpenMemberProfile={openMemberProfile}
                onToast={showToast}
              />
            )}

            {(activeTab === 'persetujuan' || activeTab === 'admin') && effectiveIsAdmin && (
              <AdminSection
                mode={activeTab === 'persetujuan' ? 'approval' : 'admin'}
                members={members}
                siteBranding={siteBranding}
                pendingRefreshKey={pendingRefreshKey}
                cloudAdminTasks={cloudAdminTasks}
                cloudPendingWorks={cloudPendingWorks}
                cloudBlockedWords={cloudBlockedWords}
                cloudStorage={cloudStorageSummary}
                currentMemberId={effectiveMemberDocId || undefined}
                isPortalAdmin={effectiveIsAdmin}
                isFirebaseAdmin={isFirebaseAdmin}
                firebaseEmail={firebaseUser?.email ?? null}
                cloudSeeded={cloudSeeded}
                onSyncCloudNow={handleSyncCloudNow}
                onPendingCountChange={setLocalPendingWorksCount}
                onBrandingUpdated={(b) => {
                  setLocalBranding(b);
                  if (cloudSeeded) setCloudBranding(b);
                }}
                onMembersChanged={loadBootstrap}
                onNewsCreated={(article) => setLocalNews((prev) => [article, ...prev])}
                onWorkApproved={(work) => {
                  setLocalWorks((prev) => (prev.some((w) => w.id === work.id) ? prev : [work, ...prev]));
                  loadBootstrap();
                }}
                onTasksChanged={loadLmsTasks}
                onOpenAdminPanel={() => navigateTab('admin')}
                onToast={showToast}
              />
            )}
          </>
        )}
      </main>

      {/* Clean Institutional Footer (Biru Akademik + Kuning Accent) */}
      <footer className="border-t-2 border-[#FACC15] bg-[#1E3A8A] text-white mt-12 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-blue-100">
          <div>
            <p className="font-semibold text-white">
              Nedacis Media Center (NMC) · SMP Negeri 2 Ciamis
            </p>
            <p className="mt-0.5 text-blue-200">
              {siteBranding.footerAddress || 'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215'}
            </p>
          </div>
          <div className="flex flex-col sm:items-end gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <button type="button" onClick={() => navigateTab('beranda')} className="hover:text-[#FACC15] transition-colors">
                Beranda
              </button>
              <button type="button" onClick={() => navigateTab('galeri')} className="hover:text-[#FACC15] transition-colors">
                Galeri Karya
              </button>
              <button type="button" onClick={() => navigateTab('anggota')} className="hover:text-[#FACC15] transition-colors">
                Anggota
              </button>
              {effectiveUser && (
                <button type="button" onClick={() => navigateTab('tugas')} className="hover:text-[#FACC15] transition-colors">
                  Tugas LMS
                </button>
              )}
              {effectiveIsAdmin && (
                <>
                  <button type="button" onClick={() => navigateTab('absensi')} className="hover:text-[#FACC15] transition-colors">
                    Absensi NFC &amp; QR
                  </button>
                  <button type="button" onClick={() => navigateTab('persetujuan')} className="hover:text-[#FACC15] transition-colors">
                    Persetujuan Karya
                  </button>
                  <button type="button" onClick={() => navigateTab('admin')} className="hover:text-[#FACC15] transition-colors">
                    Panel Admin
                  </button>
                </>
              )}
            </div>

            {siteBranding.socialLinks && siteBranding.socialLinks.length > 0 && (
              <div className="flex items-center gap-2.5" aria-label="Sosial Media Resmi">
                {siteBranding.socialLinks
                  .filter((s) => Boolean(s.url))
                  .map((s) => (
                    <a
                      key={s.id}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      title={s.label}
                      className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white hover:text-[#FACC15] flex items-center justify-center transition-colors"
                    >
                      <SocialSilhouetteIcon
                        platform={s.platform}
                        customIconUrl={s.customIconUrl}
                        label={s.label}
                        className="w-4 h-4"
                        tone="light"
                      />
                    </a>
                  ))}
              </div>
            )}
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Tab Bar (Compact 56px, within 15% mobile sticky cap) */}
      <nav
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur border-t border-slate-200 ${
          effectiveIsAdmin ? 'flex items-center overflow-x-auto' : effectiveUser ? 'grid grid-cols-5 items-center' : 'grid grid-cols-4 items-center'
        } no-print`}
      >
        {(
          [
            ['beranda', 'Beranda', Home],
            ['galeri', 'Galeri', ImageIcon],
            ['anggota', 'Anggota', Users],
            ['jadwal', 'Jadwal', Calendar],
            ...(effectiveUser ? ([['tugas', 'Tugas', BookOpen]] as const) : []),
            ...(effectiveIsAdmin
              ? ([
                  ['absensi', 'Absensi', CreditCard],
                  ['persetujuan', 'Persetujuan', ClipboardCheck],
                  ['admin', 'Admin', Settings],
                ] as const)
              : []),
          ] as const
        ).map(([id, label, Icon]) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigateTab(id)}
              className={`relative flex flex-col items-center justify-center h-full transition-colors ${
                effectiveIsAdmin ? 'min-w-[68px] flex-1 px-1 shrink-0' : ''
              } ${active ? 'text-[#C81E1E]' : 'text-slate-500'}`}
            >
              <Icon className="w-5 h-5" />
              {id === 'persetujuan' && pendingWorksCount > 0 && (
                <span className="absolute top-1.5 right-4 w-2 h-2 rounded-full bg-[#B91C1C]" />
              )}
              {id === 'tugas' && pendingTasksCount > 0 && (
                <span className="absolute top-1.5 right-4 w-2 h-2 rounded-full bg-[#1D4ED8]" />
              )}
              <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Modals & Drawers */}
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        members={members}
        onLoginSuccess={(user, newToken) => {
          localStorage.setItem(PORTAL_MEMBER_STORAGE_KEY, user.username);
          setCurrentUser(user);
          setToken(newToken);
          if (newToken) {
            loadBootstrap();
          }
          showToast(`Selamat datang, ${user.full_name}.`, 'success');
        }}
        onGoogleLoginSuccess={(email) => {
          showToast(
            email
              ? `Terhubung ke Cloud Firestore dengan ${email}.`
              : 'Berhasil masuk dengan akun Google.',
            'success'
          );
        }}
      />

      <NotificationsDrawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        onMarkAllRead={handleMarkAllRead}
        onNavigateTarget={(target) => {
          if (!target) return;
          if (target.startsWith('profil/')) {
            openMemberProfile(target.replace('profil/', ''));
          } else if (
            ['beranda', 'galeri', 'anggota', 'jadwal', 'tugas', 'absensi', 'persetujuan', 'admin'].includes(target)
          ) {
            navigateTab(target as MainTab);
          }
        }}
      />

      {/* Toast Feedback */}
      {toast && (
        <div
          className={`fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg border text-sm font-medium ${
            toast.variant === 'success'
              ? 'bg-emerald-900 text-white border-emerald-800'
              : toast.variant === 'error'
              ? 'bg-rose-900 text-white border-rose-800'
              : 'bg-slate-900 text-white border-slate-800'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
