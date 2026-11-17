import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Newspaper,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UploadCloud,
  Usb,
  Users,
  XCircle,
} from 'lucide-react';
import type {
  AdminLmsSubmission,
  AdminLmsTask,
  LmsStageType,
  NewsArticle,
  SiteBranding,
  SocialLinkItem,
  SocialPlatform,
  StudentProfile,
  StudentWork,
} from '../types';
import { apiFetch } from '../lib/api';
import { HERO_IMAGE, formatDateID, formatTimeAgo, resolveMediaUrl } from '../lib/mediaAssets';
import { NmcLogo } from './NmcLogo';
import { SocialSilhouetteIcon } from './SocialSilhouetteIcon';

export type AdminSubTab = 'students' | 'tasks' | 'review' | 'moderation' | 'news' | 'hero' | 'branding';

interface AdminSectionProps {
  mode: 'admin' | 'approval';
  members: StudentProfile[];
  siteBranding: SiteBranding;
  pendingRefreshKey?: number;
  onPendingCountChange?: (count: number) => void;
  onBrandingUpdated: (branding: SiteBranding) => void;
  onMembersChanged: () => void;
  onNewsCreated: (article: NewsArticle) => void;
  onWorkApproved: (work: StudentWork) => void;
  onTasksChanged?: () => void;
  onOpenAdminPanel?: () => void;
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

export function AdminSection({
  mode,
  members,
  siteBranding,
  pendingRefreshKey = 0,
  onPendingCountChange,
  onBrandingUpdated,
  onMembersChanged,
  onNewsCreated,
  onWorkApproved,
  onTasksChanged,
  onOpenAdminPanel,
  onToast,
}: AdminSectionProps) {
  const [tab, setTab] = useState<AdminSubTab>(mode === 'approval' ? 'review' : 'students');

  // Create student state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('siswa123');
  const [fullName, setFullName] = useState('');
  const [nis, setNis] = useState('');
  const [kelas, setKelas] = useState('8A');
  const [division, setDivision] = useState('Fotografi');
  const [nfcUid, setNfcUid] = useState('');
  const [creatingStudent, setCreatingStudent] = useState(false);

  // Edit Full Student Profile state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editNis, setEditNis] = useState('');
  const [editKelas, setEditKelas] = useState('');
  const [editDivision, setEditDivision] = useState('Fotografi');
  const [editBio, setEditBio] = useState('');
  const [editNfc, setEditNfc] = useState('');
  const [editQrToken, setEditQrToken] = useState('');
  const [editAvatarColor, setEditAvatarColor] = useState('#1D4ED8');
  const [editPass, setEditPass] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [usbListeningMode, setUsbListeningMode] = useState<'idle' | 'edit' | 'create'>('idle');
  const [serialConnected, setSerialConnected] = useState(false);
  const editPanelRef = useRef<HTMLFormElement>(null);
  const editNfcInputRef = useRef<HTMLInputElement>(null);
  const createNfcInputRef = useRef<HTMLInputElement>(null);
  const editingIdRef = useRef<number | null>(null);
  editingIdRef.current = editingId;

  // Blocked words moderation
  const [blockedWords, setBlockedWords] = useState<Array<{ id: number; word: string }>>([]);
  const [newWord, setNewWord] = useState('');

  // News creation
  const [newsTitle, setNewsTitle] = useState('');
  const [newsCategory, setNewsCategory] = useState('Liputan Sekolah');
  const [newsSummary, setNewsSummary] = useState('');
  const [newsContent, setNewsContent] = useState('');
  const [savingNews, setSavingNews] = useState(false);

  // Branding / Logo NMC & Footer state
  const [brandNameInput, setBrandNameInput] = useState(siteBranding.brandName);
  const [footerAddressInput, setFooterAddressInput] = useState(
    siteBranding.footerAddress || 'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215'
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string>('');
  const [savingBranding, setSavingBranding] = useState(false);

  const [socialLinksInput, setSocialLinksInput] = useState<SocialLinkItem[]>(
    siteBranding.socialLinks || [
      { id: 'ig', platform: 'instagram', label: 'Instagram', url: 'https://instagram.com' },
      { id: 'tt', platform: 'tiktok', label: 'TikTok', url: 'https://tiktok.com' },
      { id: 'yt', platform: 'youtube', label: 'YouTube', url: 'https://youtube.com' },
    ]
  );
  const [savingSocial, setSavingSocial] = useState(false);
  const [uploadingIconId, setUploadingIconId] = useState<string | null>(null);

  // Beranda Hero editor state
  const [heroEyebrowInput, setHeroEyebrowInput] = useState(
    siteBranding.heroEyebrow || 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi'
  );
  const [heroTitleInput, setHeroTitleInput] = useState(
    siteBranding.heroTitle || 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis'
  );
  const [heroDescInput, setHeroDescInput] = useState(
    siteBranding.heroDescription ||
      'Wadah resmi siswa SMPN 2 Ciamis dalam bidang fotografi, videografi, penyiaran, desain grafis, dan jurnalistik sekolah—dilengkapi arsip karya digital serta sistem absensi kartu pelajar NFC/RFID dan QR Code secara real-time.'
  );
  const [heroImageFile, setHeroImageFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string>('');
  const [savingHero, setSavingHero] = useState(false);

  // Pending works review
  const [pendingWorks, setPendingWorks] = useState<StudentWork[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const hasLoadedPendingRef = useRef(false);

  // Admin LMS Tasks state
  interface DraftStage {
    key: string;
    stage_type: LmsStageType;
    title: string;
    content: string;
    attachment_url: string;
  }
  const createDefaultDraftStages = (): DraftStage[] => [
    {
      key: `st-1-${Date.now()}`,
      stage_type: 'reading',
      title: 'Tahap 1: Membaca Materi Pokok',
      content: '',
      attachment_url: '',
    },
    {
      key: `st-2-${Date.now() + 1}`,
      stage_type: 'practice',
      title: 'Tahap 2: Ringkasan Pemahaman Materi',
      content: 'Tuliskan secara singkat poin penting yang Anda pelajari sebelum mengerjakan tugas praktik.',
      attachment_url: '',
    },
    {
      key: `st-3-${Date.now() + 2}`,
      stage_type: 'upload',
      title: 'Tahap 3: Upload Hasil Tugas Akhir',
      content: 'Unggah file foto, video, atau dokumen hasil tugas Anda sesuai panduan pada materi sebelumnya.',
      attachment_url: '',
    },
  ];
  const [adminTasks, setAdminTasks] = useState<AdminLmsTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskDivision, setTaskDivision] = useState('Semua');
  const [taskPoints, setTaskPoints] = useState<number>(100);
  const [taskDueDate, setTaskDueDate] = useState('');
  const [draftStages, setDraftStages] = useState<DraftStage[]>(createDefaultDraftStages);
  const [creatingTask, setCreatingTask] = useState(false);
  const [uploadingStageKey, setUploadingStageKey] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [subFeedback, setSubFeedback] = useState<Record<number, string>>({});
  const [subPoints, setSubPoints] = useState<Record<number, number>>({});
  const [reviewingSubId, setReviewingSubId] = useState<number | null>(null);

  const activeSubTab: AdminSubTab = mode === 'approval' ? 'review' : tab;

  useEffect(() => {
    setBrandNameInput(siteBranding.brandName);
    setFooterAddressInput(
      siteBranding.footerAddress || 'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215'
    );
    setHeroEyebrowInput(siteBranding.heroEyebrow || 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi');
    setHeroTitleInput(siteBranding.heroTitle || 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis');
    setHeroDescInput(
      siteBranding.heroDescription ||
        'Wadah resmi siswa SMPN 2 Ciamis dalam bidang fotografi, videografi, penyiaran, desain grafis, dan jurnalistik sekolah—dilengkapi arsip karya digital serta sistem absensi kartu pelajar NFC/RFID dan QR Code secara real-time.'
    );
    if (siteBranding.socialLinks) {
      setSocialLinksInput(siteBranding.socialLinks);
    }
  }, [
    siteBranding.brandName,
    siteBranding.footerAddress,
    siteBranding.heroEyebrow,
    siteBranding.heroTitle,
    siteBranding.heroDescription,
    siteBranding.socialLinks,
  ]);

  const loadPendingWorks = useCallback(async () => {
    setLoadingPending(true);
    try {
      const res = await apiFetch<{ works: StudentWork[] }>('/api/admin/works/pending');
      hasLoadedPendingRef.current = true;
      setPendingWorks(res.works);
    } catch {
      // ignore
    } finally {
      setLoadingPending(false);
    }
  }, []);

  const loadAdminTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const res = await apiFetch<{ tasks: AdminLmsTask[] }>('/api/admin/tasks');
      setAdminTasks(res.tasks);
    } catch {
      // ignore
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => {
    if (hasLoadedPendingRef.current) {
      onPendingCountChange?.(pendingWorks.length);
    }
  }, [pendingWorks, onPendingCountChange]);

  useEffect(() => {
    loadPendingWorks();
  }, [loadPendingWorks, pendingRefreshKey, mode, tab]);

  useEffect(() => {
    if (activeSubTab === 'tasks') {
      loadAdminTasks();
    }
  }, [activeSubTab, loadAdminTasks]);

  useEffect(() => {
    if (activeSubTab !== 'moderation') return;
    apiFetch<{ words: Array<{ id: number; word: string }> }>('/api/admin/blocked-words')
      .then((res) => setBlockedWords(res.words))
      .catch(() => {});
  }, [activeSubTab]);

  // Global USB HID Keyboard Wedge listener while Admin is editing or listening for a card tap
  useEffect(() => {
    if (activeSubTab !== 'students' || usbListeningMode === 'idle') return;
    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const nowMs = Date.now();
      if (nowMs - lastKeyTime > 120) {
        buffer = '';
      }
      lastKeyTime = nowMs;

      if (e.key === 'Enter' && buffer.length >= 4) {
        e.preventDefault();
        const uid = buffer.trim().toUpperCase();
        buffer = '';
        if (editingIdRef.current !== null) {
          setEditNfc(uid);
        } else {
          setNfcUid(uid);
        }
        onToast(`UID Kartu terbaca dari USB Reader: ${uid}`, 'success');
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSubTab, usbListeningMode, onToast]);

  const applyScannedUid = (rawUid: string) => {
    const clean = rawUid.replace(/[^a-zA-Z0-9_-]/g, '').trim().toUpperCase();
    if (clean.length < 4) return;
    if (editingIdRef.current !== null) {
      setEditNfc(clean);
    } else {
      setNfcUid(clean);
    }
    onToast(`UID Kartu terbaca: ${clean}`, 'success');
  };

  const handleConnectSerialReader = async () => {
    const nav = navigator as Navigator & {
      serial?: { requestPort: () => Promise<{ open: (opts: { baudRate: number }) => Promise<void>; readable: ReadableStream<Uint8Array> | null }> };
    };
    if (!nav.serial) {
      onToast('Browser ini tidak mendukung Web Serial. Klik kolom UID lalu tempelkan kartu pada USB HID Reader.', 'info');
      return;
    }
    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 9600 });
      setSerialConnected(true);
      onToast('USB Serial Reader terhubung. Silakan tap kartu pada reader untuk mengisi UID NFC.', 'success');
      if (port.readable) {
        const reader = port.readable.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = '';
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split(/\r?\n/);
            lineBuffer = lines.pop() || '';
            for (const line of lines) {
              applyScannedUid(line);
            }
          }
        })().catch(() => setSerialConnected(false));
      }
    } catch {
      onToast('Koneksi USB Serial dibatalkan.', 'info');
    }
  };

  const handleStartWebNfc = async () => {
    const win = window as unknown as {
      NDEFReader?: new () => {
        scan: () => Promise<void>;
        onreading: ((ev: { serialNumber?: string }) => void) | null;
      };
    };
    if (!win.NDEFReader) {
      onToast('Sensor Web NFC hanya tersedia di Chrome Android. Pada komputer, gunakan USB Reader.', 'info');
      return;
    }
    try {
      const ndef = new win.NDEFReader();
      await ndef.scan();
      onToast('Sensor NFC HP aktif. Tempelkan kartu ke ponsel untuk mengisi UID.', 'success');
      ndef.onreading = (ev) => {
        if (ev.serialNumber) {
          applyScannedUid(ev.serialNumber.replace(/:/g, ''));
        }
      };
    } catch {
      onToast('Izin sensor NFC ditolak.', 'error');
    }
  };

  const handleCreateStudent = async (e: FormEvent) => {
    e.preventDefault();
    setCreatingStudent(true);
    try {
      await apiFetch('/api/admin/students', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          full_name: fullName,
          nis,
          kelas,
          division,
          nfc_uid: nfcUid || undefined,
        }),
      });
      setUsername('');
      setFullName('');
      setNis('');
      setNfcUid('');
      onMembersChanged();
      onToast('Akun siswa baru berhasil dibuat.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal membuat akun siswa.', 'error');
    } finally {
      setCreatingStudent(false);
    }
  };

  const openEditStudent = (m: StudentProfile) => {
    setEditingId(m.id);
    setEditFullName(m.full_name);
    setEditUsername(m.username);
    setEditNis(m.nis);
    setEditKelas(m.kelas);
    setEditDivision(m.division);
    setEditBio(m.bio);
    setEditNfc(m.nfc_uid);
    setEditQrToken(m.qr_code_token);
    setEditAvatarColor(m.avatar_color || '#1D4ED8');
    setEditPass('');
    setUsbListeningMode('edit');
    setTimeout(() => {
      editPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 40);
  };

  const handleSaveStudentEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (editingId === null) return;
    setSavingEdit(true);
    try {
      await apiFetch(`/api/admin/students/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: editFullName,
          username: editUsername,
          nis: editNis,
          kelas: editKelas,
          division: editDivision,
          bio: editBio,
          nfc_uid: editNfc,
          qr_code_token: editQrToken,
          avatar_color: editAvatarColor,
          password: editPass || undefined,
        }),
      });
      setEditingId(null);
      setUsbListeningMode('idle');
      setEditPass('');
      onMembersChanged();
      onToast('Seluruh profil siswa berhasil diperbarui.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memperbarui profil siswa.', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteStudent = async (student: StudentProfile) => {
    try {
      await apiFetch(`/api/admin/students/${student.id}`, { method: 'DELETE' });
      onMembersChanged();
      onToast(`Akun ${student.full_name} dihapus dari daftar peserta.`, 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus akun.', 'error');
    }
  };

  const handleAddBlockedWord = async (e: FormEvent) => {
    e.preventDefault();
    if (!newWord.trim()) return;
    try {
      const res = await apiFetch<{ words: Array<{ id: number; word: string }> }>('/api/admin/blocked-words', {
        method: 'POST',
        body: JSON.stringify({ word: newWord.trim() }),
      });
      setBlockedWords(res.words);
      setNewWord('');
      onToast('Kata negatif ditambahkan ke filter diskusi.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menambah kata filter.', 'error');
    }
  };

  const handleRemoveBlockedWord = async (id: number) => {
    try {
      await apiFetch(`/api/admin/blocked-words/${id}`, { method: 'DELETE' });
      setBlockedWords((prev) => prev.filter((w) => w.id !== id));
    } catch {
      // ignore
    }
  };

  const handleCreateNews = async (e: FormEvent) => {
    e.preventDefault();
    setSavingNews(true);
    try {
      const res = await apiFetch<{ article: NewsArticle }>('/api/news', {
        method: 'POST',
        body: JSON.stringify({
          title: newsTitle,
          category: newsCategory,
          summary: newsSummary,
          content: newsContent,
        }),
      });
      onNewsCreated(res.article);
      setNewsTitle('');
      setNewsSummary('');
      setNewsContent('');
      onToast('Artikel berita liputan berhasil diterbitkan di Beranda.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menerbitkan artikel.', 'error');
    } finally {
      setSavingNews(false);
    }
  };

  const handleSaveBranding = async (e: FormEvent) => {
    e.preventDefault();
    setSavingBranding(true);
    try {
      const formData = new FormData();
      formData.append('brandName', brandNameInput);
      formData.append('footerAddress', footerAddressInput);
      if (logoFile) {
        formData.append('logo', logoFile);
      }
      const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/site-logo', {
        method: 'POST',
        body: formData,
      });
      onBrandingUpdated(res.siteSettings);
      if (logoPreviewUrl) {
        URL.revokeObjectURL(logoPreviewUrl);
      }
      setLogoFile(null);
      setLogoPreviewUrl('');
      onToast('Logo NMC, identitas header, dan teks footer berhasil diperbarui.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memperbarui logo & footer.', 'error');
    } finally {
      setSavingBranding(false);
    }
  };

  const handleResetBranding = async () => {
    setSavingBranding(true);
    try {
      const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/site-logo', {
        method: 'POST',
        body: JSON.stringify({ reset: 'true' }),
      });
      onBrandingUpdated(res.siteSettings);
      setBrandNameInput(res.siteSettings.brandName);
      if (logoPreviewUrl) {
        URL.revokeObjectURL(logoPreviewUrl);
      }
      setLogoFile(null);
      setLogoPreviewUrl('');
      onToast('Logo & footer dikembalikan ke pengaturan bawaan.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mereset logo.', 'error');
    } finally {
      setSavingBranding(false);
    }
  };

  const handleSaveSocialLinks = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSocial(true);
    try {
      const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/social-links', {
        method: 'POST',
        body: JSON.stringify({ socialLinks: socialLinksInput }),
      });
      onBrandingUpdated(res.siteSettings);
      onToast('Ikon siluet dan tautan media sosial footer berhasil disimpan.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan media sosial.', 'error');
    } finally {
      setSavingSocial(false);
    }
  };

  const handleResetSocialLinks = async () => {
    setSavingSocial(true);
    try {
      const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/social-links', {
        method: 'POST',
        body: JSON.stringify({ reset: true }),
      });
      onBrandingUpdated(res.siteSettings);
      if (res.siteSettings.socialLinks) {
        setSocialLinksInput(res.siteSettings.socialLinks);
      }
      onToast('Tautan media sosial dikembalikan ke Instagram, TikTok, dan YouTube bawaan.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mereset media sosial.', 'error');
    } finally {
      setSavingSocial(false);
    }
  };

  const handleUploadSocialIcon = async (id: string, file: File) => {
    setUploadingIconId(id);
    try {
      const fd = new FormData();
      fd.append('icon', file);
      const res = await apiFetch<{ iconUrl: string }>('/api/admin/social-icon', {
        method: 'POST',
        body: fd,
      });
      setSocialLinksInput((prev) =>
        prev.map((item) => (item.id === id ? { ...item, customIconUrl: res.iconUrl } : item))
      );
      onToast('Ikon siluet kustom diunggah. Klik Simpan Media Sosial untuk menerapkan.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengunggah ikon.', 'error');
    } finally {
      setUploadingIconId(null);
    }
  };

  const handleSaveHero = async (e: FormEvent) => {
    e.preventDefault();
    setSavingHero(true);
    try {
      const formData = new FormData();
      formData.append('heroEyebrow', heroEyebrowInput);
      formData.append('heroTitle', heroTitleInput);
      formData.append('heroDescription', heroDescInput);
      if (heroImageFile) {
        formData.append('heroImage', heroImageFile);
      }
      const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/hero-settings', {
        method: 'POST',
        body: formData,
      });
      onBrandingUpdated(res.siteSettings);
      if (heroPreviewUrl) {
        URL.revokeObjectURL(heroPreviewUrl);
      }
      setHeroImageFile(null);
      setHeroPreviewUrl('');
      onToast('Tampilan Hero Beranda berhasil diperbarui.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan Hero Beranda.', 'error');
    } finally {
      setSavingHero(false);
    }
  };

  const handleResetHero = async () => {
    setSavingHero(true);
    try {
      const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/hero-settings', {
        method: 'POST',
        body: JSON.stringify({ reset: 'true' }),
      });
      onBrandingUpdated(res.siteSettings);
      if (heroPreviewUrl) {
        URL.revokeObjectURL(heroPreviewUrl);
      }
      setHeroImageFile(null);
      setHeroPreviewUrl('');
      onToast('Konten Hero Beranda dikembalikan ke teks & foto bawaan.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mereset Hero Beranda.', 'error');
    } finally {
      setSavingHero(false);
    }
  };

  const handleUploadStageMaterial = async (stageKey: string, file: File) => {
    setUploadingStageKey(stageKey);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch<{ fileUrl: string; fileName: string }>('/api/admin/tasks/upload-material', {
        method: 'POST',
        body: fd,
      });
      setDraftStages((prev) =>
        prev.map((st) => (st.key === stageKey ? { ...st, attachment_url: res.fileUrl } : st))
      );
      onToast(`File materi "${res.fileName}" berhasil dilampirkan.`, 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengunggah lampiran materi.', 'error');
    } finally {
      setUploadingStageKey(null);
    }
  };

  const handleMoveDraftStage = (index: number, dir: -1 | 1) => {
    setDraftStages((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy;
    });
  };

  const handleCreateLmsTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) {
      onToast('Judul tugas LMS wajib diisi.', 'error');
      return;
    }
    if (draftStages.length === 0) {
      onToast('Tambahkan minimal satu tahapan pembelajaran.', 'error');
      return;
    }
    setCreatingTask(true);
    try {
      const res = await apiFetch<{ task: AdminLmsTask }>('/api/admin/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: taskTitle.trim(),
          description: taskDesc.trim(),
          division: taskDivision,
          points_reward: Number(taskPoints) || 100,
          due_date: taskDueDate,
          stages: draftStages.map((s) => ({
            stage_type: s.stage_type,
            title: s.title,
            content: s.content,
            attachment_url: s.attachment_url,
          })),
        }),
      });
      setAdminTasks((prev) => [res.task, ...prev]);
      setTaskTitle('');
      setTaskDesc('');
      setTaskDueDate('');
      setTaskPoints(100);
      setDraftStages(createDefaultDraftStages());
      onTasksChanged?.();
      onToast('Tugas LMS baru berhasil dibuat dan dikirim ke akun anggota!', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal membuat tugas LMS.', 'error');
    } finally {
      setCreatingTask(false);
    }
  };

  const handleDeleteLmsTask = async (taskId: number) => {
    try {
      await apiFetch(`/api/admin/tasks/${taskId}`, { method: 'DELETE' });
      setAdminTasks((prev) => prev.filter((t) => t.id !== taskId));
      onTasksChanged?.();
      onToast('Tugas LMS telah dihapus.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus tugas LMS.', 'error');
    }
  };

  const handleReviewSubmission = async (
    task: AdminLmsTask,
    sub: AdminLmsSubmission,
    status: 'approved' | 'revision'
  ) => {
    setReviewingSubId(sub.id);
    try {
      const nextPoints =
        status === 'revision' ? 0 : subPoints[sub.id] ?? sub.points_awarded ?? task.points_reward;
      const feedback = subFeedback[sub.id] ?? sub.admin_feedback ?? '';
      await apiFetch(`/api/admin/task-submissions/${sub.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          points_awarded: nextPoints,
          admin_feedback: feedback,
        }),
      });
      await loadAdminTasks();
      onTasksChanged?.();
      onMembersChanged();
      onToast(
        status === 'approved'
          ? `Tugas ${sub.full_name} disetujui (+${nextPoints} poin).`
          : `Permintaan revisi dikirim ke ${sub.full_name}.`,
        status === 'approved' ? 'success' : 'info'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memproses penilaian tugas.', 'error');
    } finally {
      setReviewingSubId(null);
    }
  };

  const handleReviewWork = async (work: StudentWork, decision: 'approved' | 'rejected') => {
    setReviewingId(work.id);
    try {
      const note = reviewNotes[work.id] || '';
      const res = await apiFetch<{ work: StudentWork }>(`/api/admin/works/${work.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      });
      setPendingWorks((prev) => prev.filter((w) => w.id !== work.id));
      if (decision === 'approved' && res.work) {
        onWorkApproved(res.work);
        onToast(`Karya "${work.title}" disetujui dan langsung terposting di Beranda & Galeri.`, 'success');
      } else {
        onToast(`Karya "${work.title}" ditolak dan pemberitahuan dikirim ke siswa.`, 'info');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memproses peninjauan karya.', 'error');
    } finally {
      setReviewingId(null);
    }
  };

  const renderReviewPanel = () => (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-blue-50/70 border border-blue-200 rounded-xl text-xs sm:text-sm text-slate-700">
        <p>
          Konten dan karya yang diunggah anggota masuk ke daftar ini untuk ditinjau terlebih dahulu sebelum tampil di{' '}
          <strong>Beranda</strong> dan <strong>Galeri</strong>.
        </p>
        <button
          type="button"
          onClick={loadPendingWorks}
          disabled={loadingPending}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingPending ? 'animate-spin' : ''}`} />
          Muat Ulang ({pendingWorks.length})
        </button>
      </div>

      {loadingPending && pendingWorks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
          Memuat antrean persetujuan karya siswa...
        </div>
      ) : pendingWorks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-2">
          <ClipboardCheck className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-800">Semua konten siswa sudah ditinjau</p>
          <p className="text-xs text-slate-500">
            Belum ada karya baru dari anggota yang menunggu persetujuan saat ini.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingWorks.map((work) => (
            <article
              key={work.id}
              className="border border-slate-200 rounded-2xl p-4 sm:p-5 grid grid-cols-1 md:grid-cols-12 gap-5 bg-white"
            >
              <div className="md:col-span-5 aspect-[4/3] bg-slate-100 rounded-xl overflow-hidden border border-slate-200">
                {work.media_type === 'video' ? (
                  <video src={resolveMediaUrl(work.media_url)} controls className="w-full h-full object-cover" />
                ) : (
                  <img
                    src={resolveMediaUrl(work.media_url)}
                    alt={work.title}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="md:col-span-7 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500">
                    {work.category} · {work.media_type === 'video' ? 'Video' : 'Foto'} · {formatTimeAgo(work.created_at)}
                  </p>
                  <h3 className="text-lg font-semibold text-slate-900">{work.title}</h3>
                  <p className="text-xs font-medium text-[#1D4ED8]">
                    Pengunggah: {work.author_name} (Kelas {work.author_kelas} · @{work.author_username})
                  </p>
                  {work.description && (
                    <p className="text-sm text-slate-600 leading-relaxed pt-1">{work.description}</p>
                  )}
                </div>

                <div className="space-y-2.5 pt-3 border-t border-slate-100">
                  <input
                    type="text"
                    value={reviewNotes[work.id] || ''}
                    onChange={(e) =>
                      setReviewNotes((prev) => ({ ...prev, [work.id]: e.target.value }))
                    }
                    placeholder="Catatan pembina untuk siswa (opsional)..."
                    className="w-full px-3.5 py-2 text-xs sm:text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={reviewingId === work.id}
                      onClick={() => handleReviewWork(work, 'approved')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Setujui &amp; Terbitkan di Beranda
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === work.id}
                      onClick={() => handleReviewWork(work, 'rejected')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-50 rounded-xl"
                    >
                      <XCircle className="w-4 h-4" />
                      Tolak Konten
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  if (mode === 'approval') {
    return (
      <section className="space-y-6">
        <div className="border-b border-slate-200 pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#B91C1C]">
              Kurasi Pembina · MMC SMPN 2 Ciamis
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight mt-1">
              Persetujuan Konten &amp; Karya Siswa
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Tinjau foto, poster, maupun video yang diunggah siswa sebelum diterbitkan secara publik ke halaman Beranda dan Galeri Karya.
            </p>
          </div>
          {onOpenAdminPanel && (
            <button
              type="button"
              onClick={onOpenAdminPanel}
              className="px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl whitespace-nowrap self-start sm:self-auto"
            >
              Buka Panel Admin Lengkap
            </button>
          )}
        </div>

        {renderReviewPanel()}
      </section>
    );
  }

  const studentMembers = members.filter((m) => m.role === 'student');

  return (
    <section className="space-y-6">
      {/* Editorial Full-Page Header */}
      <div className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#B91C1C]">
          Administrasi Ekstrakurikuler · MMC SMPN 2 Ciamis
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight mt-1">
          Panel Admin &amp; Pembina MMC
        </h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Kelola 20 akun siswa, pembina, dan kartu NFC, tinjau persetujuan karya anggota, atur filter komentar negatif, terbitkan liputan sekolah, serta ubah logo header NMC.
        </p>
      </div>

      {/* Main Panel Container */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {/* Sub-navigation */}
        <div className="px-4 sm:px-6 pt-3 border-b border-slate-200 flex items-center gap-2 overflow-x-auto bg-slate-50/70">
          <button
            type="button"
            onClick={() => setTab('students')}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'students'
                ? 'border-[#B91C1C] text-[#B91C1C] font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            Akun Siswa ({studentMembers.length}/20)
          </button>
          <button
            type="button"
            onClick={() => setTab('tasks')}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'tasks'
                ? 'border-[#B91C1C] text-[#B91C1C] font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Tugas LMS ({adminTasks.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('review')}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'review'
                ? 'border-[#B91C1C] text-[#B91C1C] font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            Persetujuan Karya ({pendingWorks.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('moderation')}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'moderation'
                ? 'border-[#B91C1C] text-[#B91C1C] font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            Filter Komentar Negatif
          </button>
          <button
            type="button"
            onClick={() => setTab('news')}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'news'
                ? 'border-[#B91C1C] text-[#B91C1C] font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Newspaper className="w-4 h-4" />
            Terbitkan Berita Liputan
          </button>
          <button
            type="button"
            onClick={() => setTab('hero')}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'hero'
                ? 'border-[#B91C1C] text-[#B91C1C] font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutTemplate className="w-4 h-4" />
            Beranda / Hero
          </button>
          <button
            type="button"
            onClick={() => setTab('branding')}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'branding'
                ? 'border-[#B91C1C] text-[#B91C1C] font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            Logo &amp; Footer
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          {tab === 'students' && (
            <div className="space-y-6">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-3">
                <div className="space-y-1">
                  <p className="font-semibold text-slate-900">
                    Kapasitas Peserta Terdaftar: {studentMembers.length} dari 20 Siswa (+{members.length - studentMembers.length} Pembina)
                  </p>
                  <p>
                    Password bawaan seluruh akun siswa awal adalah <span className="font-mono font-semibold">siswa123</span>. Untuk mengubah UID kartu NFC/RFID dengan USB Reader, klik tombol edit pada siswa lalu tempelkan kartu ke USB Reader.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleConnectSerialReader}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      serialConnected
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Usb className="w-3.5 h-3.5" />
                    {serialConnected ? 'USB Serial Aktif' : 'Hubungkan USB Serial Reader'}
                  </button>
                  <button
                    type="button"
                    onClick={handleStartWebNfc}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    Baca via NFC HP
                  </button>
                </div>
              </div>

              {/* Create Student Form */}
              <form onSubmit={handleCreateStudent} className="border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-slate-900">Tambah Akun Siswa Baru</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nama lengkap siswa"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username login"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                  <input
                    type="text"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password awal"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                  <input
                    type="text"
                    required
                    value={nis}
                    onChange={(e) => setNis(e.target.value)}
                    placeholder="NIS (mis. 242507021)"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                  <input
                    type="text"
                    required
                    value={kelas}
                    onChange={(e) => setKelas(e.target.value)}
                    placeholder="Kelas (mis. 8A)"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  />
                  <select
                    value={division}
                    onChange={(e) => setDivision(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-xl"
                  >
                    <option value="Fotografi">Fotografi</option>
                    <option value="Videografi">Videografi</option>
                    <option value="Jurnalistik">Jurnalistik</option>
                    <option value="Desain Grafis">Desain Grafis</option>
                    <option value="Penyiaran">Penyiaran</option>
                  </select>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                  <div className="w-full sm:flex-1 flex items-center gap-2">
                    <input
                      ref={createNfcInputRef}
                      type="text"
                      value={nfcUid}
                      onFocus={() => setUsbListeningMode('create')}
                      onChange={(e) => setNfcUid(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (nfcUid.trim()) {
                            onToast(`UID Kartu terbaca: ${nfcUid.trim().toUpperCase()}`, 'success');
                          }
                        }
                      }}
                      placeholder="Tap kartu di USB Reader atau ketik UID NFC/RFID (opsional)"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setUsbListeningMode('create');
                        createNfcInputRef.current?.focus();
                        onToast('Siap membaca kartu. Tempelkan kartu ke USB Reader sekarang.', 'info');
                      }}
                      title="Scan UID Kartu dengan USB Reader"
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium bg-amber-100 hover:bg-[#FACC15] text-amber-950 rounded-xl whitespace-nowrap shrink-0"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      Tap USB
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={creatingStudent || studentMembers.length >= 20}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 rounded-xl whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    {studentMembers.length >= 20 ? 'Kuota 20 Siswa Penuh' : 'Buat Akun Siswa'}
                  </button>
                </div>
              </form>

              {/* Full Student Profile Editor Panel */}
              {editingId !== null && (
                <form
                  ref={editPanelRef}
                  onSubmit={handleSaveStudentEdit}
                  className="border-2 border-[#1D4ED8] bg-blue-50/30 rounded-2xl p-5 space-y-4"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-blue-100 pb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Edit Profil Lengkap Siswa
                      </h3>
                      <p className="text-xs text-slate-500">
                        Ubah identitas, divisi, bio, password, atau tempelkan kartu pada USB Reader untuk memperbarui UID NFC.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setUsbListeningMode('idle');
                      }}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200"
                    >
                      Tutup Editor
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Nama Lengkap</label>
                      <input
                        type="text"
                        required
                        value={editFullName}
                        onChange={(e) => setEditFullName(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Username Login</label>
                      <input
                        type="text"
                        required
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">NIS</label>
                      <input
                        type="text"
                        required
                        value={editNis}
                        onChange={(e) => setEditNis(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Kelas</label>
                      <input
                        type="text"
                        required
                        value={editKelas}
                        onChange={(e) => setEditKelas(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Divisi</label>
                      <select
                        value={editDivision}
                        onChange={(e) => setEditDivision(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                      >
                        <option value="Fotografi">Fotografi</option>
                        <option value="Videografi">Videografi</option>
                        <option value="Jurnalistik">Jurnalistik</option>
                        <option value="Desain Grafis">Desain Grafis</option>
                        <option value="Penyiaran">Penyiaran</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Reset Password Baru (Opsional)</label>
                      <input
                        type="text"
                        value={editPass}
                        onChange={(e) => setEditPass(e.target.value)}
                        placeholder="Kosongkan jika tidak diubah"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">UID Kartu NFC / RFID (Bisa Tap USB Reader)</label>
                      <div className="flex items-center gap-2">
                        <input
                          ref={editNfcInputRef}
                          type="text"
                          required
                          value={editNfc}
                          onFocus={() => setUsbListeningMode('edit')}
                          onChange={(e) => setEditNfc(e.target.value.toUpperCase())}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (editNfc.trim()) {
                                onToast(`UID baru terbaca dari USB Reader: ${editNfc.trim().toUpperCase()}. Klik Simpan Perubahan.`, 'success');
                              }
                            }
                          }}
                          placeholder="Tap kartu di USB Reader..."
                          className="flex-1 px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setEditNfc('');
                            setUsbListeningMode('edit');
                            editNfcInputRef.current?.focus();
                            onToast('Siap merekam kartu baru. Tempelkan kartu pelajar ke USB Reader.', 'info');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-[#FACC15] hover:bg-[#EAB308] text-amber-950 rounded-xl whitespace-nowrap shrink-0"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          Scan USB
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">Token QR Code</label>
                      <input
                        type="text"
                        required
                        value={editQrToken}
                        onChange={(e) => setEditQrToken(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Bio / Deskripsi Profil Siswa</label>
                    <textarea
                      rows={2}
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-600">Warna Avatar:</span>
                      {['#C81E1E', '#1D4ED8', '#CA8A04', '#0F766E', '#4338CA', '#BE123C'].map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setEditAvatarColor(hex)}
                          aria-label={`Pilih warna ${hex}`}
                          className={`w-6 h-6 rounded-full border-2 transition-transform ${
                            editAvatarColor === hex ? 'border-slate-900 scale-110' : 'border-white'
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setUsbListeningMode('idle');
                        }}
                        className="px-4 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={savingEdit}
                        className="px-5 py-2 text-xs sm:text-sm font-semibold bg-[#1D4ED8] hover:bg-[#1E40AF] text-white rounded-xl"
                      >
                        {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan Profil'}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Existing 20 students list */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Nama &amp; Kelas</th>
                      <th className="py-3 px-4">Username</th>
                      <th className="py-3 px-4">UID NFC/RFID</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {members.map((m) => (
                      <tr key={m.id} className={editingId === m.id ? 'bg-blue-50/40' : ''}>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{m.full_name}</p>
                          <p className={`text-xs ${m.role === 'admin' ? 'font-medium text-[#B91C1C]' : 'text-slate-500'}`}>
                            {m.role === 'admin'
                              ? `Pembina · ${m.division} · ${m.nis}`
                              : `Kelas ${m.kelas} · ${m.division} · NIS ${m.nis}`}
                          </p>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700">{m.username}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700">{m.nfc_uid}</td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditStudent(m)}
                              title="Edit Nama & Semua Profil"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#1D4ED8] hover:bg-blue-50 rounded-lg"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            {m.role === 'student' && (
                              <button
                                type="button"
                                onClick={() => handleDeleteStudent(m)}
                                title="Hapus akun siswa"
                                className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'tasks' && (
            <div className="space-y-8">
              <form onSubmit={handleCreateLmsTask} className="border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5 bg-slate-50/50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      Buat Tugas Anggota Baru (Alur Bertahap LMS)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Susun tahapan berurutan dari membaca materi hingga unggah hasil tugas akhir. Tugas otomatis tampil di akun anggota setelah masuk.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                  <div className="sm:col-span-6">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Judul Tugas LMS</label>
                    <input
                      type="text"
                      required
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      placeholder="Contoh: Teknik Wawancara & Liputan Acara Sekolah"
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Divisi Target</label>
                    <select
                      value={taskDivision}
                      onChange={(e) => setTaskDivision(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    >
                      <option value="Semua">Semua Divisi</option>
                      <option value="Fotografi">Fotografi</option>
                      <option value="Videografi">Videografi</option>
                      <option value="Jurnalistik">Jurnalistik</option>
                      <option value="Desain Grafis">Desain Grafis</option>
                      <option value="Penyiaran">Penyiaran</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Poin Tugas</label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      required
                      value={taskPoints}
                      onChange={(e) => setTaskPoints(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Batas Waktu</label>
                    <input
                      type="date"
                      value={taskDueDate}
                      onChange={(e) => setTaskDueDate(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Deskripsi Tugas</label>
                  <textarea
                    rows={2}
                    value={taskDesc}
                    onChange={(e) => setTaskDesc(e.target.value)}
                    placeholder="Jelaskan tujuan pembelajaran dan ringkasan tugas yang harus diselesaikan anggota..."
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                {/* Stage Builder */}
                <div className="space-y-3 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                      Tahapan Pembelajaran Berurutan ({draftStages.length} Tahap)
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDraftStages((prev) => [
                            ...prev,
                            {
                              key: `st-${Date.now()}-${Math.random()}`,
                              stage_type: 'reading',
                              title: `Tahap ${prev.length + 1}: Membaca Materi`,
                              content: '',
                              attachment_url: '',
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-slate-700"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Tambah Materi
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftStages((prev) => [
                            ...prev,
                            {
                              key: `st-${Date.now()}-${Math.random()}`,
                              stage_type: 'practice',
                              title: `Tahap ${prev.length + 1}: Refleksi / Pemahaman`,
                              content: '',
                              attachment_url: '',
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-slate-700"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Tambah Refleksi
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftStages((prev) => [
                            ...prev,
                            {
                              key: `st-${Date.now()}-${Math.random()}`,
                              stage_type: 'upload',
                              title: `Tahap ${prev.length + 1}: Upload Hasil Tugas`,
                              content: 'Unggah file tugas Anda untuk menyelesaikan modul dan meraih poin.',
                              attachment_url: '',
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-xl text-[#1D4ED8]"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        Tambah Upload Tugas
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {draftStages.map((st, idx) => (
                      <div key={st.key} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#B91C1C]">
                            Tahap {idx + 1}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveDraftStage(idx, -1)}
                              title="Geser ke atas"
                              className="p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 rounded-lg"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === draftStages.length - 1}
                              onClick={() => handleMoveDraftStage(idx, 1)}
                              title="Geser ke bawah"
                              className="p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 rounded-lg"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            {draftStages.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDraftStages((prev) => prev.filter((x) => x.key !== st.key))
                                }
                                title="Hapus tahap"
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                          <div className="sm:col-span-4">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Jenis Tahapan
                            </label>
                            <select
                              value={st.stage_type}
                              onChange={(e) => {
                                const nextType = e.target.value as LmsStageType;
                                setDraftStages((prev) =>
                                  prev.map((x) => (x.key === st.key ? { ...x, stage_type: nextType } : x))
                                );
                              }}
                              className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl"
                            >
                              <option value="reading">Membaca Materi</option>
                              <option value="practice">Latihan / Refleksi Singkat</option>
                              <option value="upload">Upload Tugas Akhir</option>
                            </select>
                          </div>
                          <div className="sm:col-span-8">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Judul Tahap
                            </label>
                            <input
                              type="text"
                              required
                              value={st.title}
                              onChange={(e) =>
                                setDraftStages((prev) =>
                                  prev.map((x) => (x.key === st.key ? { ...x, title: e.target.value } : x))
                                )
                              }
                              className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            {st.stage_type === 'reading'
                              ? 'Isi Materi Bacaan'
                              : st.stage_type === 'practice'
                              ? 'Pertanyaan / Panduan Refleksi'
                              : 'Instruksi Upload Tugas'}
                          </label>
                          <textarea
                            rows={3}
                            value={st.content}
                            onChange={(e) =>
                              setDraftStages((prev) =>
                                prev.map((x) => (x.key === st.key ? { ...x, content: e.target.value } : x))
                              )
                            }
                            placeholder={
                              st.stage_type === 'reading'
                                ? 'Tulis materi pembelajaran yang harus dibaca siswa pada tahap ini...'
                                : 'Tulis panduan pengerjaan atau kriteria file yang diunggah siswa...'
                            }
                            className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl"
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <label className="inline-flex items-center gap-1.5 text-[#1D4ED8] font-medium cursor-pointer hover:underline">
                            <FileText className="w-3.5 h-3.5" />
                            {uploadingStageKey === st.key
                              ? 'Mengunggah lampiran...'
                              : st.attachment_url
                              ? 'Ganti Lampiran Materi (PDF/Gambar/Video)'
                              : 'Lampirkan File Materi Opsional (PDF/Gambar/Video)'}
                            <input
                              type="file"
                              accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUploadStageMaterial(st.key, file);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          {st.attachment_url && (
                            <div className="flex items-center gap-3">
                              <a
                                href={resolveMediaUrl(st.attachment_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-emerald-700 font-medium hover:underline"
                              >
                                Lampiran Terpasang
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  setDraftStages((prev) =>
                                    prev.map((x) => (x.key === st.key ? { ...x, attachment_url: '' } : x))
                                  )
                                }
                                className="text-rose-600 hover:underline"
                              >
                                Hapus
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-slate-200">
                  <button
                    type="submit"
                    disabled={creatingTask}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-xl"
                  >
                    <Plus className="w-4 h-4" />
                    {creatingTask ? 'Menerbitkan Tugas...' : 'Terbitkan Tugas LMS ke Anggota'}
                  </button>
                </div>
              </form>

              {/* Published LMS Tasks & Submissions Monitoring */}
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900">
                    Daftar Tugas Terbit &amp; Pengumpulan Anggota ({adminTasks.length})
                  </h3>
                  <button
                    type="button"
                    onClick={loadAdminTasks}
                    disabled={loadingTasks}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-700"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingTasks ? 'animate-spin' : ''}`} />
                    Muat Ulang
                  </button>
                </div>

                {adminTasks.length === 0 ? (
                  <div className="border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                    Belum ada tugas LMS yang diterbitkan.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {adminTasks.map((t) => {
                      const isExpanded = expandedTaskId === t.id;
                      return (
                        <div key={t.id} className="border border-slate-200 rounded-2xl bg-white overflow-hidden">
                          <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <p className="text-xs text-slate-500 font-mono tabular-nums">
                                {t.division === 'Semua' ? 'Semua Divisi' : `Divisi ${t.division}`} ·{' '}
                                {t.stages.length} Tahap · +{t.points_reward} Poin
                                {t.due_date ? ` · Batas ${formatDateID(t.due_date)}` : ''}
                              </p>
                              <h4 className="text-base font-semibold text-slate-900">{t.title}</h4>
                              {t.description && (
                                <p className="text-xs text-slate-600 line-clamp-2">{t.description}</p>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                                className="px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 rounded-xl whitespace-nowrap"
                              >
                                {isExpanded
                                  ? 'Tutup Pengumpulan'
                                  : `Pengumpulan (${t.submissions.length})`}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteLmsTask(t.id)}
                                title="Hapus tugas LMS"
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-slate-200 bg-slate-50/60 p-4 sm:p-5 space-y-3">
                              {t.submissions.length === 0 ? (
                                <p className="text-xs text-slate-500 text-center py-4">
                                  Belum ada anggota yang mengunggah hasil tugas ini.
                                </p>
                              ) : (
                                t.submissions.map((sub) => (
                                  <div
                                    key={sub.id}
                                    className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div>
                                        <p className="text-sm font-semibold text-slate-900">
                                          {sub.full_name}{' '}
                                          <span className="text-xs font-normal text-slate-500">
                                            ({sub.kelas} · {sub.division})
                                          </span>
                                        </p>
                                        <p className="text-[11px] font-mono text-slate-500">
                                          Dikirim {formatTimeAgo(sub.submitted_at)} · Status:{' '}
                                          <span
                                            className={
                                              sub.status === 'approved'
                                                ? 'text-emerald-700 font-semibold'
                                                : sub.status === 'revision'
                                                ? 'text-amber-700 font-semibold'
                                                : 'text-[#1D4ED8] font-semibold'
                                            }
                                          >
                                            {sub.status === 'approved'
                                              ? 'Disetujui'
                                              : sub.status === 'revision'
                                              ? 'Perlu Revisi'
                                              : 'Terkirim'}
                                          </span>
                                        </p>
                                      </div>

                                      {sub.file_url && (
                                        <a
                                          href={resolveMediaUrl(sub.file_url)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 rounded-lg"
                                        >
                                          <FileText className="w-3.5 h-3.5" />
                                          {sub.file_name || 'Lihat File Tugas'}
                                        </a>
                                      )}
                                    </div>

                                    {sub.submission_note && (
                                      <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                        {sub.submission_note}
                                      </p>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center pt-1">
                                      <div className="sm:col-span-2">
                                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                          Poin Diberikan
                                        </label>
                                        <input
                                          type="number"
                                          min={0}
                                          max={10000}
                                          value={subPoints[sub.id] ?? sub.points_awarded ?? t.points_reward}
                                          onChange={(e) =>
                                            setSubPoints((prev) => ({
                                              ...prev,
                                              [sub.id]: Number(e.target.value),
                                            }))
                                          }
                                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                                        />
                                      </div>
                                      <div className="sm:col-span-6">
                                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                          Umpan Balik Pembina
                                        </label>
                                        <input
                                          type="text"
                                          value={subFeedback[sub.id] ?? sub.admin_feedback ?? ''}
                                          onChange={(e) =>
                                            setSubFeedback((prev) => ({
                                              ...prev,
                                              [sub.id]: e.target.value,
                                            }))
                                          }
                                          placeholder="Tulis apresiasi atau catatan perbaikan..."
                                          className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                                        />
                                      </div>
                                      <div className="sm:col-span-4 flex flex-wrap justify-end gap-1.5 pt-3 sm:pt-4">
                                        <button
                                          type="button"
                                          disabled={reviewingSubId === sub.id}
                                          onClick={() => handleReviewSubmission(t, sub, 'approved')}
                                          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                                        >
                                          Setujui Poin
                                        </button>
                                        <button
                                          type="button"
                                          disabled={reviewingSubId === sub.id}
                                          onClick={() => handleReviewSubmission(t, sub, 'revision')}
                                          className="px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg"
                                        >
                                          Minta Revisi
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'review' && renderReviewPanel()}

          {tab === 'moderation' && (
            <div className="space-y-5">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700">
                Sistem otomatis menahan komentar yang mengandung kata-kata di bawah ini agar ruang diskusi karya siswa tetap sopan, sehat, dan edukatif. Anda juga dapat menonaktifkan komentar atau menghapus konten langsung pada detail karya di Galeri.
              </div>

              <form onSubmit={handleAddBlockedWord} className="flex gap-2.5">
                <input
                  type="text"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  placeholder="Tambah kata negatif yang ingin disaring..."
                  className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl whitespace-nowrap"
                >
                  Tambah Kata Filter
                </button>
              </form>

              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                {blockedWords.map((bw) => (
                  <div key={bw.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <span className="font-mono text-slate-800">{bw.word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveBlockedWord(bw.id)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'news' && (
            <form onSubmit={handleCreateNews} className="space-y-4 max-w-3xl">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Judul Berita Liputan</label>
                <input
                  type="text"
                  required
                  value={newsTitle}
                  onChange={(e) => setNewsTitle(e.target.value)}
                  placeholder="Contoh: Tim MMC Liput Kejuaraan Lomba Pramuka Tingkat Kabupaten"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Kategori</label>
                <select
                  value={newsCategory}
                  onChange={(e) => setNewsCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                >
                  <option value="Liputan Sekolah">Liputan Sekolah</option>
                  <option value="Prestasi">Prestasi</option>
                  <option value="Workshop">Workshop</option>
                  <option value="Siaran">Siaran</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Ringkasan Singkat</label>
                <textarea
                  rows={2}
                  required
                  value={newsSummary}
                  onChange={(e) => setNewsSummary(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Isi Berita Lengkap</label>
                <textarea
                  rows={6}
                  required
                  value={newsContent}
                  onChange={(e) => setNewsContent(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingNews}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl"
                >
                  {savingNews ? 'Menerbitkan...' : 'Terbitkan ke Beranda'}
                </button>
              </div>
            </form>
          )}

          {tab === 'hero' && (
            <form onSubmit={handleSaveHero} className="space-y-6">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <p className="text-xs font-semibold text-slate-900">
                  Pratinjau Bagian Hero Beranda (Kiri &amp; Foto Kanan)
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                  <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-[#C81E1E]">
                      {heroEyebrowInput || 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi'}
                    </p>
                    <h3 className="font-serif text-lg sm:text-xl font-semibold text-slate-900 leading-snug">
                      {heroTitleInput || 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis'}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed line-clamp-4">
                      {heroDescInput}
                    </p>
                  </div>
                  <div className="lg:col-span-6 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[16/10] lg:aspect-auto lg:min-h-[180px]">
                    <img
                      src={
                        heroPreviewUrl ||
                        (siteBranding.heroImageUrl ? resolveMediaUrl(siteBranding.heroImageUrl) : HERO_IMAGE)
                      }
                      alt="Pratinjau Hero Beranda"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 max-w-3xl">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Label Atas (Eyebrow)
                  </label>
                  <input
                    type="text"
                    value={heroEyebrowInput}
                    onChange={(e) => setHeroEyebrowInput(e.target.value)}
                    placeholder="SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Judul Utama Beranda (H1)
                  </label>
                  <input
                    type="text"
                    required
                    value={heroTitleInput}
                    onChange={(e) => setHeroTitleInput(e.target.value)}
                    placeholder="Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Paragraf Deskripsi Beranda
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={heroDescInput}
                    onChange={(e) => setHeroDescInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Ganti Foto Utama Hero (JPG / PNG / WebP)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (heroPreviewUrl) URL.revokeObjectURL(heroPreviewUrl);
                      setHeroImageFile(file);
                      setHeroPreviewUrl(file ? URL.createObjectURL(file) : '');
                    }}
                    className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#1D4ED8] hover:file:bg-blue-100 border border-slate-300 rounded-xl p-1.5"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Biarkan kosong jika tidak ingin mengganti foto hero saat ini.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 max-w-3xl">
                <button
                  type="button"
                  disabled={savingHero}
                  onClick={handleResetHero}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset ke Bawaan
                </button>
                <button
                  type="submit"
                  disabled={savingHero}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl"
                >
                  {savingHero ? 'Menyimpan...' : 'Simpan Tampilan Hero'}
                </button>
              </div>
            </form>
          )}

          {tab === 'branding' && (
            <>
            <form onSubmit={handleSaveBranding} className="space-y-5 max-w-3xl">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-700 space-y-2">
                <p className="font-semibold text-slate-900">Pratinjau Logo pada Header Merah</p>
                <div className="bg-[#B91C1C] border-b-2 border-[#FACC15] rounded-xl px-5 py-3.5 flex items-center justify-between">
                  <NmcLogo
                    logoUrl={logoPreviewUrl || siteBranding.logoUrl}
                    brandName={brandNameInput}
                  />
                  <span className="text-[11px] text-white/75 hidden sm:inline">Pratinjau Header Atas</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Unggah File Logo NMC Baru (PNG / JPG / SVG / WebP)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
                      setLogoFile(file);
                      setLogoPreviewUrl(file ? URL.createObjectURL(file) : '');
                    }}
                    className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#1D4ED8] hover:file:bg-blue-100 border border-slate-300 rounded-xl p-1.5"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Disarankan logo transparan (PNG/SVG) agar tampil bersih di atas header merah.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Teks Nama di Samping Logo (Opsional)
                  </label>
                  <input
                    type="text"
                    value={brandNameInput}
                    onChange={(e) => setBrandNameInput(e.target.value)}
                    placeholder="Kosongkan jika logo sudah memuat teks"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Contoh: <span className="font-mono">Multimedia</span>
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Alamat / Keterangan Bawah Footer
                </label>
                <input
                  type="text"
                  value={footerAddressInput}
                  onChange={(e) => setFooterAddressInput(e.target.value)}
                  placeholder="Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Ditampilkan di bagian bawah footer situs di bawah nama organisasi.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={savingBranding}
                  onClick={handleResetBranding}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset ke Bawaan
                </button>
                <button
                  type="submit"
                  disabled={savingBranding}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl"
                >
                  {savingBranding ? 'Menyimpan...' : 'Simpan Logo & Footer'}
                </button>
              </div>
            </form>

            {/* Social Media Silhouette Links Editor */}
            <form
              onSubmit={handleSaveSocialLinks}
              className="mt-8 pt-8 border-t border-slate-200 space-y-5 max-w-3xl"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Ikon Siluet &amp; Tautan Sosial Media Footer
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Atur ikon logo siluet (Instagram, TikTok, YouTube, atau ikon kustom) serta alamat tautannya pada footer situs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSocialLinksInput((prev) => [
                      ...prev,
                      {
                        id: `soc-${Date.now()}`,
                        platform: 'instagram',
                        label: 'Media Sosial',
                        url: 'https://',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl whitespace-nowrap self-start"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Media Sosial
                </button>
              </div>

              {/* Preview on Footer Blue Strip */}
              <div className="bg-[#1E3A8A] border-t-2 border-[#FACC15] rounded-xl px-5 py-3.5 flex items-center justify-between text-white">
                <span className="text-xs text-blue-100">Pratinjau Ikon Siluet di Footer:</span>
                <div className="flex items-center gap-3">
                  {socialLinksInput.map((item) => (
                    <span
                      key={item.id}
                      title={item.label}
                      className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white hover:text-[#FACC15]"
                    >
                      <SocialSilhouetteIcon
                        platform={item.platform}
                        customIconUrl={item.customIconUrl}
                        label={item.label}
                        className="w-4 h-4"
                        tone="light"
                      />
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {socialLinksInput.map((item) => (
                  <div
                    key={item.id}
                    className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Platform / Siluet
                        </label>
                        <select
                          value={item.platform}
                          onChange={(e) => {
                            const nextPlat = e.target.value as SocialPlatform;
                            const labelMap: Record<SocialPlatform, string> = {
                              instagram: 'Instagram',
                              tiktok: 'TikTok',
                              youtube: 'YouTube',
                              facebook: 'Facebook',
                              x: 'X',
                              website: 'Website',
                              custom: 'Sosial Media',
                            };
                            setSocialLinksInput((prev) =>
                              prev.map((x) =>
                                x.id === item.id
                                  ? { ...x, platform: nextPlat, label: labelMap[nextPlat] || x.label }
                                  : x
                              )
                            );
                          }}
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl"
                        >
                          <option value="instagram">Instagram</option>
                          <option value="tiktok">TikTok</option>
                          <option value="youtube">YouTube</option>
                          <option value="facebook">Facebook</option>
                          <option value="x">X / Twitter</option>
                          <option value="website">Website</option>
                          <option value="custom">Kustom</option>
                        </select>
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Label Tooltip
                        </label>
                        <input
                          type="text"
                          value={item.label}
                          onChange={(e) =>
                            setSocialLinksInput((prev) =>
                              prev.map((x) => (x.id === item.id ? { ...x, label: e.target.value } : x))
                            )
                          }
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl"
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Tautan / URL Profil
                        </label>
                        <input
                          type="text"
                          value={item.url}
                          onChange={(e) =>
                            setSocialLinksInput((prev) =>
                              prev.map((x) => (x.id === item.id ? { ...x, url: e.target.value } : x))
                            )
                          }
                          placeholder="https://instagram.com/mmc.smpn2ciamis"
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl"
                        />
                      </div>

                      <div className="sm:col-span-1 flex justify-end pt-4 sm:pt-0">
                        <button
                          type="button"
                          onClick={() =>
                            setSocialLinksInput((prev) => prev.filter((x) => x.id !== item.id))
                          }
                          title="Hapus media sosial"
                          className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 text-[11px] text-slate-600">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-slate-200 flex items-center justify-center text-slate-800">
                          <SocialSilhouetteIcon
                            platform={item.platform}
                            customIconUrl={item.customIconUrl}
                            label={item.label}
                            className="w-3.5 h-3.5"
                            tone="dark"
                          />
                        </span>
                        <span>
                          {item.customIconUrl
                            ? 'Menggunakan ikon kustom (otomatis siluet putih di footer)'
                            : 'Menggunakan ikon siluet bawaan'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="cursor-pointer font-medium text-[#1D4ED8] hover:underline">
                          {uploadingIconId === item.id ? 'Mengunggah...' : 'Ganti Ikon Kustom'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleUploadSocialIcon(item.id, file);
                            }}
                          />
                        </label>
                        {item.customIconUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setSocialLinksInput((prev) =>
                                prev.map((x) =>
                                  x.id === item.id ? { ...x, customIconUrl: '' } : x
                                )
                              )
                            }
                            className="text-rose-600 hover:underline"
                          >
                            Pakai Bawaan
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={savingSocial}
                  onClick={handleResetSocialLinks}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset Media Sosial
                </button>
                <button
                  type="submit"
                  disabled={savingSocial}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl"
                >
                  {savingSocial ? 'Menyimpan...' : 'Simpan Media Sosial'}
                </button>
              </div>
            </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
