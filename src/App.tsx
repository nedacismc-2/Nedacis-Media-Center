import { useCallback, useEffect, useState } from 'react';
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

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('beranda');
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [selectedWork, setSelectedWork] = useState<StudentWork | null>(null);

  const [currentUser, setCurrentUser] = useState<StudentProfile | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [members, setMembers] = useState<StudentProfile[]>([]);
  const [works, setWorks] = useState<StudentWork[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [lmsTasks, setLmsTasks] = useState<LmsTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [siteBranding, setSiteBranding] = useState<SiteBranding>({
    brandName: 'Multimedia',
    logoUrl: '',
    socialLinks: [
      { id: 'ig', platform: 'instagram', label: 'Instagram', url: 'https://instagram.com' },
      { id: 'tt', platform: 'tiktok', label: 'TikTok', url: 'https://tiktok.com' },
      { id: 'yt', platform: 'youtube', label: 'YouTube', url: 'https://youtube.com' },
    ],
  });

  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [latestAttendanceEvent, setLatestAttendanceEvent] = useState<AttendanceRecord | null>(null);

  const [loginOpen, setLoginOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [pendingWorksCount, setPendingWorksCount] = useState(0);
  const [pendingRefreshKey, setPendingRefreshKey] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);

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

      setCurrentUser(data.user);
      setNews(data.news);
      setSchedules(data.schedules);
      setMembers(data.members);
      setWorks(data.works);
      setAttendanceRecords(data.attendance);
      setLmsTasks(data.lmsTasks || []);
      if (data.siteSettings) {
        setSiteBranding(data.siteSettings);
      }
      if (!data.user && getStoredToken()) {
        setStoredToken(null);
        setToken(null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLmsTasks = useCallback(async () => {
    if (!getStoredToken()) {
      setLmsTasks([]);
      return;
    }
    try {
      const res = await apiFetch<{ tasks: LmsTask[]; totalPoints: number }>('/api/tasks');
      setLmsTasks(res.tasks);
      setCurrentUser((prev) => (prev ? { ...prev, lms_points: res.totalPoints } : prev));
    } catch {
      // ignore
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!getStoredToken()) {
      setNotifications([]);
      return;
    }
    try {
      const res = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(res.notifications);
    } catch {
      setNotifications([]);
    }
  }, []);

  const loadPendingCount = useCallback(async () => {
    if (!getStoredToken()) {
      setPendingWorksCount(0);
      return;
    }
    try {
      const res = await apiFetch<{ works: StudentWork[] }>('/api/admin/works/pending');
      setPendingWorksCount(res.works.length);
    } catch {
      setPendingWorksCount(0);
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
        setPendingWorksCount(0);
      }
    } else {
      setNotifications([]);
      setPendingWorksCount(0);
    }
  }, [currentUser, loadNotifications, loadPendingCount]);

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

  // Real-time WebSocket event handling
  useEffect(() => {
    const cleanup = connectRealtimeSocket(
      token,
      (event: WSEvent) => {
        if (event.type === 'attendance:recorded') {
          const rec = event.payload;
          setLatestAttendanceEvent(rec);
          setAttendanceRecords((prev) => {
            const existsIdx = prev.findIndex(
              (r) => r.user_id === rec.user_id && r.attendance_date === rec.attendance_date
            );
            if (existsIdx >= 0) {
              return prev.map((r, i) => (i === existsIdx ? rec : r));
            }
            return [rec, ...prev];
          });
          setMembers((prev) =>
            prev.map((m) =>
              m.id === rec.user_id ? { ...m, attendance_count: (m.attendance_count ?? 0) + 1 } : m
            )
          );
        } else if (event.type === 'notification:new') {
          const notif = event.payload;
          setNotifications((prev) => {
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
          setWorks((prev) => (prev.some((w) => w.id === work.id) ? prev : [work, ...prev]));
          setPendingRefreshKey((k) => k + 1);
        } else if (event.type === 'work:deleted') {
          const { id } = event.payload;
          setWorks((prev) => prev.filter((w) => w.id !== id));
          setSelectedWork((prev) => (prev?.id === id ? null : prev));
          setPendingRefreshKey((k) => k + 1);
        } else if (event.type === 'work:updated') {
          const patch = event.payload;
          setWorks((prev) => prev.map((w) => (w.id === patch.id ? { ...w, ...patch } : w)));
          setSelectedWork((prev) => (prev?.id === patch.id ? { ...prev, ...patch } : prev));
        } else if (event.type === 'comment:created') {
          const c = event.payload;
          setWorks((prev) =>
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
          setWorks((prev) =>
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
          setSchedules((prev) => (prev.some((s) => s.id === sched.id) ? prev : [...prev, sched]));
        } else if (event.type === 'settings:updated') {
          setSiteBranding(event.payload);
        } else if (event.type === 'member:updated') {
          const { id, avatar_url } = event.payload;
          setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, avatar_url } : m)));
          setWorks((prev) =>
            prev.map((w) => (w.user_id === id ? { ...w, author_avatar_url: avatar_url } : w))
          );
          setCurrentUser((prev) => (prev && prev.id === id ? { ...prev, avatar_url } : prev));
        } else if (event.type === 'member:points_updated') {
          const { id, lms_points } = event.payload;
          setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, lms_points } : m)));
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
  }, [token, currentUser, showToast, loadLmsTasks]);

  const isAdmin = currentUser?.role === 'admin';
  const isAdminOnlyTab = (t: MainTab) => t === 'absensi' || t === 'persetujuan' || t === 'admin';

  useEffect(() => {
    if (!loading && isAdminOnlyTab(activeTab) && !isAdmin) {
      setActiveTab('beranda');
    }
    if (!loading && activeTab === 'tugas' && !currentUser) {
      setActiveTab('beranda');
    }
  }, [activeTab, isAdmin, currentUser, loading]);

  const navigateTab = (tab: MainTab) => {
    if (isAdminOnlyTab(tab) && !isAdmin) {
      showToast('Menu ini hanya dapat diakses oleh Pembina / Admin.', 'error');
      return;
    }
    if (tab === 'tugas' && !currentUser) {
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
    setStoredToken(null);
    setToken(null);
    setCurrentUser(null);
    setAttendanceRecords([]);
    setLmsTasks([]);
    setNotifications([]);
    setPendingWorksCount(0);
    if (isAdminOnlyTab(activeTab) || activeTab === 'tugas') {
      setActiveTab('beranda');
    }
    showToast('Anda telah keluar dari akun.', 'info');
  };

  const handleMarkAllRead = async () => {
    await apiFetch('/api/notifications/read', { method: 'POST' }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
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
                ...(currentUser
                  ? ([
                      [
                        'tugas',
                        pendingTasksCount > 0 ? `Tugas (${pendingTasksCount})` : 'Tugas',
                      ],
                    ] as const)
                  : []),
                ...(isAdmin
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
            {currentUser ? (
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

                {currentUser.role === 'admin' ? (
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
                    onClick={() => openMemberProfile(currentUser.username)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-amber-950 bg-[#FACC15] hover:bg-[#FDE047] rounded-xl transition-colors min-h-[40px] whitespace-nowrap max-w-[150px]"
                  >
                    <User className="w-4 h-4 shrink-0" />
                    <span className="truncate">{currentUser.full_name.split(' ')[0]}</span>
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
            Memuat portal Multimedia Media Center SMPN 2 Ciamis...
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
                currentUser={currentUser}
                lmsTasks={lmsTasks}
                isAdmin={isAdmin}
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
                currentUser={currentUser}
                selectedWork={selectedWork}
                onSelectWork={setSelectedWork}
                onOpenMemberProfile={openMemberProfile}
                onRequireLogin={() => setLoginOpen(true)}
                onWorkCreated={(w) => setWorks((prev) => (prev.some((x) => x.id === w.id) ? prev : [w, ...prev]))}
                onWorkDeleted={(id) => setWorks((prev) => prev.filter((x) => x.id !== id))}
                onWorkPatch={(id, patch) => {
                  setWorks((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
                  setSelectedWork((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
                }}
                onToast={showToast}
              />
            )}

            {activeTab === 'anggota' && (
              <MembersSection
                members={members}
                currentUser={currentUser}
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
                  setMembers((prev) =>
                    prev.map((m) => (m.id === updatedUser.id ? { ...m, avatar_url: updatedUser.avatar_url } : m))
                  );
                }}
                onWorkApprovedOrAdminCreated={(w) =>
                  setWorks((prev) => (prev.some((x) => x.id === w.id) ? prev : [w, ...prev]))
                }
                onToast={showToast}
                latestAttendanceEvent={latestAttendanceEvent}
              />
            )}

            {activeTab === 'jadwal' && (
              <ScheduleSection
                schedules={schedules}
                currentUser={currentUser}
                onScheduleAdded={(s) => setSchedules((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]))}
                onScheduleDeleted={(id) => setSchedules((prev) => prev.filter((s) => s.id !== id))}
                onToast={showToast}
              />
            )}

            {activeTab === 'tugas' && currentUser && (
              <LmsTasksSection
                currentUser={currentUser}
                tasks={lmsTasks}
                initialSelectedTaskId={selectedTaskId}
                onTaskUpdated={(updatedTask, newTotalPoints) => {
                  setLmsTasks((prev) =>
                    prev.map((t) => (t.id === updatedTask.id ? updatedTask : t))
                  );
                  if (newTotalPoints !== undefined) {
                    setCurrentUser((prev) => (prev ? { ...prev, lms_points: newTotalPoints } : prev));
                    setMembers((prev) =>
                      prev.map((m) =>
                        m.id === currentUser.id ? { ...m, lms_points: newTotalPoints } : m
                      )
                    );
                  }
                }}
                onToast={showToast}
              />
            )}

            {activeTab === 'absensi' && isAdmin && (
              <AttendanceHub
                members={members}
                attendanceRecords={attendanceRecords}
                currentUser={currentUser}
                wsConnected={wsConnected}
                onAttendanceRecorded={(rec) => {
                  setLatestAttendanceEvent(rec);
                  setAttendanceRecords((prev) => {
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

            {(activeTab === 'persetujuan' || activeTab === 'admin') && isAdmin && (
              <AdminSection
                mode={activeTab === 'persetujuan' ? 'approval' : 'admin'}
                members={members}
                siteBranding={siteBranding}
                pendingRefreshKey={pendingRefreshKey}
                onPendingCountChange={setPendingWorksCount}
                onBrandingUpdated={setSiteBranding}
                onMembersChanged={loadBootstrap}
                onNewsCreated={(article) => setNews((prev) => [article, ...prev])}
                onWorkApproved={(work) => {
                  setWorks((prev) => (prev.some((w) => w.id === work.id) ? prev : [work, ...prev]));
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
              Multimedia Media Center (MMC) · SMP Negeri 2 Ciamis
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
              {currentUser && (
                <button type="button" onClick={() => navigateTab('tugas')} className="hover:text-[#FACC15] transition-colors">
                  Tugas LMS
                </button>
              )}
              {isAdmin && (
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
          isAdmin ? 'flex items-center overflow-x-auto' : currentUser ? 'grid grid-cols-5 items-center' : 'grid grid-cols-4 items-center'
        } no-print`}
      >
        {(
          [
            ['beranda', 'Beranda', Home],
            ['galeri', 'Galeri', ImageIcon],
            ['anggota', 'Anggota', Users],
            ['jadwal', 'Jadwal', Calendar],
            ...(currentUser ? ([['tugas', 'Tugas', BookOpen]] as const) : []),
            ...(isAdmin
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
                isAdmin ? 'min-w-[68px] flex-1 px-1 shrink-0' : ''
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
        onLoginSuccess={(user, newToken) => {
          setCurrentUser(user);
          setToken(newToken);
          loadBootstrap();
          showToast(`Selamat datang, ${user.full_name}.`, 'success');
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
