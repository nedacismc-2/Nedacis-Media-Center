import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  ClipboardCheck,
  Cloud,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  HardDrive,
  Image as ImageIcon,
  LayoutTemplate,
  Newspaper,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  UploadCloud,
  Usb,
  Users,
  Video,
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
import { apiFetch, getStoredToken } from '../lib/api';
import { useFirebase } from '../context/FirebaseContext';
import { auth } from '../lib/firebase';
import {
  CLOUD_FILE_PREFIX,
  deleteMultipleUploadedFilesFromCloud,
  deleteUploadedFileFromCloud,
  downloadOrOpenMedia,
  formatBytes,
  uploadFileToCloud,
  type CloudStorageSummary,
  type CloudUploadedFileRecord,
} from '../lib/cloudFiles';
import {
  addBlockedWordInFirestore,
  createLmsTaskInFirestore,
  createNewsInFirestore,
  deleteBlockedWordInFirestore,
  deleteLmsTaskInFirestore,
  deleteStudentFromFirestore,
  importStudentsToFirestore,
  reviewLmsSubmissionInFirestore,
  reviewWorkInFirestore,
  sanitizeDocId,
  saveSiteSettingsToFirestore,
  saveStudentToFirestore,
} from '../lib/firestoreSync';
import {
  buildMembersCsv,
  buildMembersJson,
  buildMembersTemplateCsv,
  parseAndValidateMemberImport,
  triggerTextFileDownload,
  type MemberImportPreview,
} from '../lib/memberExportImport';
import { HERO_IMAGE, formatDateID, formatTimeAgo } from '../lib/mediaAssets';
import { CloudFileAttachment, CloudImage, CloudVideo } from './CloudMedia';
import { NmcLogo } from './NmcLogo';
import { SocialSilhouetteIcon } from './SocialSilhouetteIcon';

export type AdminSubTab = 'students' | 'tasks' | 'review' | 'moderation' | 'news' | 'hero' | 'branding' | 'database';

interface AdminSectionProps {
  mode: 'admin' | 'approval';
  members: StudentProfile[];
  siteBranding: SiteBranding;
  pendingRefreshKey?: number;
  cloudAdminTasks?: AdminLmsTask[];
  cloudPendingWorks?: StudentWork[];
  cloudBlockedWords?: Array<{ id: number; firestoreId?: string; word: string }>;
  cloudStorage?: CloudStorageSummary | null;
  currentMemberId?: string;
  isPortalAdmin?: boolean;
  isFirebaseAdmin?: boolean;
  firebaseEmail?: string | null;
  cloudSeeded?: boolean;
  onSyncCloudNow?: () => Promise<void>;
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
  cloudAdminTasks,
  cloudPendingWorks,
  cloudBlockedWords,
  cloudStorage = null,
  currentMemberId,
  isPortalAdmin = false,
  isFirebaseAdmin = false,
  firebaseEmail = null,
  cloudSeeded = false,
  onSyncCloudNow,
  onPendingCountChange,
  onBrandingUpdated,
  onMembersChanged,
  onNewsCreated,
  onWorkApproved,
  onTasksChanged,
  onOpenAdminPanel,
  onToast,
}: AdminSectionProps) {
  const { signInWithGoogle } = useFirebase();
  const canWriteCloudAdmin = isPortalAdmin || isFirebaseAdmin;
  const [tab, setTab] = useState<AdminSubTab>(mode === 'approval' ? 'review' : 'students');
  const [syncingCloud, setSyncingCloud] = useState(false);

  // Cloud Storage Manager state
  const [storageSearch, setStorageSearch] = useState('');
  const [storageTypeFilter, setStorageTypeFilter] = useState<'all' | 'image' | 'video' | 'other'>('all');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [confirmDeleteMode, setConfirmDeleteMode] = useState<'none' | 'bulk' | string>('none');
  const [deletingStorageFiles, setDeletingStorageFiles] = useState(false);
  const [connectingGoogleAdmin, setConnectingGoogleAdmin] = useState(false);

  // Create student state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('siswa123');
  const [fullName, setFullName] = useState('');
  const [nis, setNis] = useState('');
  const [kelas, setKelas] = useState('8A');
  const [division, setDivision] = useState('Fotografi');
  const [nfcUid, setNfcUid] = useState('');
  const [parentWhatsapp, setParentWhatsapp] = useState('');
  const [creatingStudent, setCreatingStudent] = useState(false);

  // Export / Import Member Data state
  const [importOverwrite, setImportOverwrite] = useState(true);
  const [importRawFile, setImportRawFile] = useState<{ name: string; content: string } | null>(null);
  const [importPreview, setImportPreview] = useState<MemberImportPreview | null>(null);
  const [importParseError, setImportParseError] = useState('');
  const [importingMembers, setImportingMembers] = useState(false);
  const [importResultSummary, setImportResultSummary] = useState<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

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
  const [editParentWhatsapp, setEditParentWhatsapp] = useState('');
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
  const [blockedWords, setBlockedWords] = useState<Array<{ id: number; firestoreId?: string; word: string }>>([]);
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
    if (canWriteCloudAdmin && cloudPendingWorks) {
      hasLoadedPendingRef.current = true;
      setPendingWorks(cloudPendingWorks);
      return;
    }
    if (!getStoredToken()) return;
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
  }, [canWriteCloudAdmin, cloudPendingWorks]);

  const loadAdminTasks = useCallback(async () => {
    if (canWriteCloudAdmin && cloudAdminTasks && cloudAdminTasks.length > 0) {
      setAdminTasks(cloudAdminTasks);
      return;
    }
    if (!getStoredToken()) {
      if (cloudAdminTasks) setAdminTasks(cloudAdminTasks);
      return;
    }
    setLoadingTasks(true);
    try {
      const res = await apiFetch<{ tasks: AdminLmsTask[] }>('/api/admin/tasks');
      setAdminTasks(res.tasks);
    } catch {
      if (cloudAdminTasks) setAdminTasks(cloudAdminTasks);
    } finally {
      setLoadingTasks(false);
    }
  }, [canWriteCloudAdmin, cloudAdminTasks]);

  useEffect(() => {
    if (canWriteCloudAdmin && cloudPendingWorks) {
      hasLoadedPendingRef.current = true;
      setPendingWorks(cloudPendingWorks);
    }
  }, [canWriteCloudAdmin, cloudPendingWorks]);

  useEffect(() => {
    if (canWriteCloudAdmin && cloudAdminTasks && cloudAdminTasks.length > 0) {
      setAdminTasks(cloudAdminTasks);
    }
  }, [canWriteCloudAdmin, cloudAdminTasks]);

  useEffect(() => {
    if (hasLoadedPendingRef.current) {
      onPendingCountChange?.(pendingWorks.length);
    }
  }, [pendingWorks, onPendingCountChange]);

  // Prune selected file IDs that no longer exist
  useEffect(() => {
    if (!cloudStorage) {
      setSelectedFileIds([]);
      return;
    }
    const existing = new Set(cloudStorage.files.map((f) => f.fileId));
    setSelectedFileIds((prev) => prev.filter((id) => existing.has(id)));
  }, [cloudStorage]);

  const filteredStorageFiles = useMemo<CloudUploadedFileRecord[]>(() => {
    if (!cloudStorage) return [];
    const q = storageSearch.trim().toLowerCase();
    return cloudStorage.files.filter((f) => {
      if (storageTypeFilter === 'image' && !f.mimeType.startsWith('image/')) return false;
      if (storageTypeFilter === 'video' && !f.mimeType.startsWith('video/')) return false;
      if (storageTypeFilter === 'other' && (f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/'))) {
        return false;
      }
      if (!q) return true;
      return (
        f.fileName.toLowerCase().includes(q) ||
        f.uploaderUid.toLowerCase().includes(q) ||
        f.mimeType.toLowerCase().includes(q)
      );
    });
  }, [cloudStorage, storageSearch, storageTypeFilter]);

  const selectedEstimatedBytes = useMemo(() => {
    if (!cloudStorage || selectedFileIds.length === 0) return 0;
    const set = new Set(selectedFileIds);
    return cloudStorage.files
      .filter((f) => set.has(f.fileId))
      .reduce((sum, f) => sum + f.estimatedFirestoreBytes, 0);
  }, [cloudStorage, selectedFileIds]);

  const handleToggleSelectFile = (fileId: string) => {
    setConfirmDeleteMode('none');
    setSelectedFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const handleDeleteSingleCloudFile = async (file: CloudUploadedFileRecord) => {
    if (!isFirebaseAdmin) {
      onToast('Hubungkan Google Admin terlebih dahulu untuk menghapus file Cloud secara permanen.', 'error');
      return;
    }
    setDeletingStorageFiles(true);
    try {
      await deleteUploadedFileFromCloud(file.fileId);
      setSelectedFileIds((prev) => prev.filter((id) => id !== file.fileId));
      setConfirmDeleteMode('none');
      onToast(`File "${file.fileName}" berhasil dihapus dari penyimpanan Cloud Firebase.`, 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus file dari Cloud.', 'error');
    } finally {
      setDeletingStorageFiles(false);
    }
  };

  const handleBulkDeleteCloudFiles = async () => {
    if (!isFirebaseAdmin) {
      onToast('Hubungkan Google Admin terlebih dahulu untuk menghapus file Cloud secara permanen.', 'error');
      return;
    }
    if (selectedFileIds.length === 0) return;
    setDeletingStorageFiles(true);
    try {
      const { deleted, failed } = await deleteMultipleUploadedFilesFromCloud(selectedFileIds);
      setSelectedFileIds([]);
      setConfirmDeleteMode('none');
      if (failed > 0) {
        onToast(`${deleted} file dihapus, ${failed} file gagal dihapus.`, 'info');
      } else {
        onToast(`${deleted} file terpilih berhasil dihapus permanen dari Cloud Firebase.`, 'success');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus file terpilih.', 'error');
    } finally {
      setDeletingStorageFiles(false);
    }
  };

  const handleConnectGoogleAdminForStorage = async () => {
    setConnectingGoogleAdmin(true);
    try {
      await signInWithGoogle();
      onToast('Berhasil terhubung dengan akun Google Admin.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal masuk dengan Google Admin.', 'error');
    } finally {
      setConnectingGoogleAdmin(false);
    }
  };

  // Database Health & Backup state
  interface DbHealthState {
    integrity: string;
    journalMode: string;
    synchronous: string;
    dbBytes: number;
    walBytes: number;
    shmBytes: number;
    lastBackupAt: string | null;
    lastBackupBytes: number;
    counts: Record<string, number>;
  }
  const [dbHealth, setDbHealth] = useState<DbHealthState | null>(null);
  const [loadingDbHealth, setLoadingDbHealth] = useState(false);
  const [runningCheckpoint, setRunningCheckpoint] = useState(false);

  const loadDbHealth = useCallback(async () => {
    setLoadingDbHealth(true);
    try {
      const res = await apiFetch<{ health: DbHealthState }>('/api/admin/database/status');
      setDbHealth(res.health);
    } catch {
      // ignore
    } finally {
      setLoadingDbHealth(false);
    }
  }, []);

  useEffect(() => {
    loadPendingWorks();
  }, [loadPendingWorks, pendingRefreshKey, mode, tab]);

  useEffect(() => {
    if (activeSubTab === 'tasks') {
      loadAdminTasks();
    } else if (activeSubTab === 'database') {
      loadDbHealth();
    }
  }, [activeSubTab, loadAdminTasks, loadDbHealth]);

  useEffect(() => {
    if (activeSubTab !== 'moderation') return;
    if (canWriteCloudAdmin && cloudBlockedWords) {
      setBlockedWords(cloudBlockedWords);
      return;
    }
    if (!getStoredToken()) return;
    apiFetch<{ words: Array<{ id: number; word: string }> }>('/api/admin/blocked-words')
      .then((res) => setBlockedWords(res.words))
      .catch(() => {});
  }, [activeSubTab, canWriteCloudAdmin, cloudBlockedWords]);

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
      const canSyncCloud = Boolean(auth.currentUser && isFirebaseAdmin);
      const hasLocalToken = Boolean(getStoredToken());
      if (!canSyncCloud && !hasLocalToken) {
        throw new Error('Sesi admin tidak aktif. Silakan masuk ulang sebagai Pembina atau Admin Utama.');
      }

      const cleanUser = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const generatedNfc = (nfcUid.trim() || `04${Date.now().toString(16).slice(-8)}`).toUpperCase();
      const generatedQr = `NMC-${cleanUser.toUpperCase().slice(0, 8)}`;

      if (canSyncCloud) {
        await saveStudentToFirestore({
          username: cleanUser,
          role: 'student',
          full_name: fullName.trim(),
          nis: nis.trim(),
          kelas,
          division,
          bio: `Peserta aktif divisi ${division} Nedacis Media Center SMPN 2 Ciamis.`,
          nfc_uid: generatedNfc,
          qr_code_token: generatedQr,
          parent_whatsapp: parentWhatsapp.trim(),
          avatar_color: '#1D4ED8',
          show_in_members: true,
          password: password.trim() || undefined,
        });
      }
      if (hasLocalToken) {
        await apiFetch('/api/admin/students', {
          method: 'POST',
          body: JSON.stringify({
            username: cleanUser,
            password,
            full_name: fullName,
            nis,
            kelas,
            division,
            nfc_uid: generatedNfc,
            qr_code_token: generatedQr,
            parent_whatsapp: parentWhatsapp.trim() || undefined,
            cloud_synced: canSyncCloud,
          }),
        }).catch((err) => {
          if (!canSyncCloud) throw err;
        });
      }
      setUsername('');
      setFullName('');
      setNis('');
      setNfcUid('');
      setParentWhatsapp('');
      onMembersChanged();
      onToast(
        canSyncCloud
          ? 'Akun siswa baru berhasil dibuat dan tersimpan di Cloud.'
          : 'Akun siswa baru berhasil dibuat dan disinkronkan ke portal Pembina.',
        'success'
      );
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
    setEditParentWhatsapp(m.parent_whatsapp || '');
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
      const canSyncCloud = Boolean(auth.currentUser && isFirebaseAdmin);
      const hasLocalToken = Boolean(getStoredToken());
      if (!canSyncCloud && !hasLocalToken) {
        throw new Error('Sesi admin tidak aktif. Silakan masuk ulang sebagai Pembina atau Admin Utama.');
      }

      const normalizedEditUname = editUsername.trim().toLowerCase();
      const targetMember =
        members.find((m) => m.id === editingId) ||
        members.find((m) => m.username.trim().toLowerCase() === normalizedEditUname);
      if (canSyncCloud) {
        await saveStudentToFirestore({
          memberId: targetMember?.firestoreId,
          legacyId: editingId,
          username: normalizedEditUname,
          role: targetMember?.role || 'student',
          full_name: editFullName.trim(),
          nis: editNis.trim(),
          kelas: editKelas.trim(),
          division: editDivision,
          bio: editBio.trim(),
          nfc_uid: editNfc.trim(),
          qr_code_token: editQrToken.trim(),
          parent_whatsapp: editParentWhatsapp.trim(),
          avatar_color: editAvatarColor,
          avatar_url: targetMember?.avatar_url,
          show_in_members: targetMember?.show_in_members !== 0,
          password: editPass.trim() || undefined,
        });
      }
      if (hasLocalToken) {
        await apiFetch(`/api/admin/students/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            original_username: targetMember?.username || normalizedEditUname,
            full_name: editFullName,
            username: editUsername,
            role: targetMember?.role,
            nis: editNis,
            kelas: editKelas,
            division: editDivision,
            bio: editBio,
            nfc_uid: editNfc,
            qr_code_token: editQrToken,
            parent_whatsapp: editParentWhatsapp.trim(),
            avatar_color: editAvatarColor,
            avatar_url: targetMember?.avatar_url,
            password: editPass || undefined,
            cloud_synced: canSyncCloud,
          }),
        }).catch((err) => {
          if (!canSyncCloud) throw err;
        });
      }
      setEditingId(null);
      setUsbListeningMode('idle');
      setEditPass('');
      onMembersChanged();
      onToast('Seluruh profil siswa berhasil diperbarui dan disinkronkan.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memperbarui profil siswa.', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteStudent = async (student: StudentProfile) => {
    try {
      const canSyncCloud = Boolean(auth.currentUser && isFirebaseAdmin);
      const hasLocalToken = Boolean(getStoredToken());
      if (!canSyncCloud && !hasLocalToken) {
        throw new Error('Sesi admin tidak aktif. Silakan masuk ulang sebagai Pembina atau Admin Utama.');
      }

      if (canSyncCloud) {
        const fId = student.firestoreId || sanitizeDocId(`member_${student.username}`);
        await deleteStudentFromFirestore(fId);
      }
      if (hasLocalToken) {
        await apiFetch(
          `/api/admin/students/${student.id}?username=${encodeURIComponent(student.username)}&cloud_synced=${canSyncCloud ? '1' : '0'}`,
          { method: 'DELETE' }
        ).catch((err) => {
          if (!canSyncCloud) throw err;
        });
      }
      onMembersChanged();
      onToast(`Akun ${student.full_name} dihapus dari daftar peserta.`, 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus akun.', 'error');
    }
  };

  useEffect(() => {
    if (!importRawFile) return;
    try {
      const preview = parseAndValidateMemberImport(
        importRawFile.name,
        importRawFile.content,
        members,
        importOverwrite
      );
      setImportPreview(preview);
      setImportParseError('');
    } catch (err) {
      setImportPreview(null);
      setImportParseError(err instanceof Error ? err.message : 'Gagal membaca file import.');
    }
  }, [importRawFile, importOverwrite, members]);

  const handleExportMembers = (format: 'csv' | 'json' | 'template') => {
    const today = new Date().toISOString().slice(0, 10);
    if (format === 'template') {
      triggerTextFileDownload(
        'template-import-anggota-nmc.csv',
        buildMembersTemplateCsv(),
        'text/csv;charset=utf-8;'
      );
      onToast('Template CSV anggota berhasil diunduh.', 'success');
      return;
    }
    if (members.length === 0) {
      onToast('Belum ada data anggota untuk diekspor.', 'info');
      return;
    }
    if (format === 'csv') {
      triggerTextFileDownload(
        `nmc-data-anggota-${today}.csv`,
        buildMembersCsv(members),
        'text/csv;charset=utf-8;'
      );
      onToast(`Berhasil mengekspor ${members.length} data anggota ke CSV.`, 'success');
    } else {
      triggerTextFileDownload(
        `nmc-data-anggota-${today}.json`,
        buildMembersJson(members),
        'application/json;charset=utf-8;'
      );
      onToast(`Berhasil mengekspor ${members.length} data anggota ke JSON.`, 'success');
    }
  };

  const handleImportFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setImportResultSummary(null);
    setImportParseError('');
    try {
      const text = await file.text();
      setImportRawFile({ name: file.name, content: text });
    } catch {
      setImportParseError('Gagal membaca isi file yang dipilih.');
      setImportPreview(null);
    }
  };

  const handleClearImport = () => {
    setImportRawFile(null);
    setImportPreview(null);
    setImportParseError('');
    if (importFileInputRef.current) {
      importFileInputRef.current.value = '';
    }
  };

  const handleExecuteMemberImport = async () => {
    if (!importPreview) return;
    const actionable = importPreview.rows.filter(
      (r) => r.action === 'create' || r.action === 'overwrite'
    );
    if (actionable.length === 0) {
      onToast('Tidak ada baris data yang perlu dibuat atau ditimpa.', 'info');
      return;
    }

    const canSyncCloud = Boolean(auth.currentUser && isFirebaseAdmin);
    const hasLocalToken = Boolean(getStoredToken());
    if (!canSyncCloud && !hasLocalToken) {
      onToast('Hubungkan akun Google Admin terlebih dahulu untuk mengimport data anggota ke Cloud.', 'error');
      return;
    }

    setImportingMembers(true);
    try {
      const payload = actionable.map((r) => r.data);
      let finalSummary = {
        created: 0,
        updated: 0,
        skipped: importPreview.skipCount,
        errors: [] as string[],
      };

      if (canSyncCloud) {
        const cloudRes = await importStudentsToFirestore(payload, {
          overwrite: importOverwrite,
          existingMembers: members,
        });
        finalSummary = {
          created: cloudRes.created,
          updated: cloudRes.updated,
          skipped: importPreview.skipCount + cloudRes.skipped,
          errors: [...cloudRes.errors],
        };
      }

      if (hasLocalToken) {
        const localRes = await apiFetch<{
          created: number;
          updated: number;
          skipped: number;
          errors?: string[];
        }>('/api/admin/students/import', {
          method: 'POST',
          body: JSON.stringify({
            students: payload,
            overwrite: importOverwrite,
            cloud_synced: canSyncCloud,
          }),
        }).catch((err) => {
          if (!canSyncCloud) throw err;
          return null;
        });

        if (localRes && !canSyncCloud) {
          finalSummary = {
            created: localRes.created,
            updated: localRes.updated,
            skipped: importPreview.skipCount + localRes.skipped,
            errors: localRes.errors || [],
          };
        }
      }

      setImportResultSummary(finalSummary);
      handleClearImport();
      onMembersChanged();
      onToast(
        `Import selesai: ${finalSummary.created} baru, ${finalSummary.updated} ditimpa, ${finalSummary.skipped} dilewati.`,
        finalSummary.errors.length > 0 ? 'info' : 'success'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengimport data anggota.', 'error');
    } finally {
      setImportingMembers(false);
    }
  };

  const handleAddBlockedWord = async (e: FormEvent) => {
    e.preventDefault();
    if (!newWord.trim()) return;
    try {
      if (auth.currentUser || canWriteCloudAdmin) {
        await addBlockedWordInFirestore(newWord.trim(), currentMemberId);
      }
      if (getStoredToken()) {
        const res = await apiFetch<{ words: Array<{ id: number; word: string }> }>('/api/admin/blocked-words', {
          method: 'POST',
          body: JSON.stringify({ word: newWord.trim() }),
        }).catch(() => null);
        if (res && !canWriteCloudAdmin) setBlockedWords(res.words);
      }
      setNewWord('');
      onToast('Kata negatif ditambahkan ke filter diskusi.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menambah kata filter.', 'error');
    }
  };

  const handleRemoveBlockedWord = async (bw: { id: number; firestoreId?: string; word: string }) => {
    try {
      if ((auth.currentUser || canWriteCloudAdmin) && bw.firestoreId) {
        await deleteBlockedWordInFirestore(bw.firestoreId);
      }
      if (getStoredToken()) {
        await apiFetch(`/api/admin/blocked-words/${bw.id}`, { method: 'DELETE' }).catch(() => {});
      }
      setBlockedWords((prev) => prev.filter((w) => w.id !== bw.id));
    } catch {
      // ignore
    }
  };

  const handleCreateNews = async (e: FormEvent) => {
    e.preventDefault();
    setSavingNews(true);
    try {
      let createdArticle: NewsArticle | null = null;
      const publishedAt = new Date().toISOString().slice(0, 10);

      if (auth.currentUser || canWriteCloudAdmin) {
        const fId = await createNewsInFirestore({
          title: newsTitle,
          category: newsCategory,
          summary: newsSummary,
          content: newsContent,
          authorName: 'Pembina NMC SMPN 2 Ciamis',
          publishedAt,
          createdByMemberId: currentMemberId,
        });
        createdArticle = {
          id: Date.now(),
          firestoreId: fId,
          title: newsTitle,
          slug: fId,
          category: newsCategory,
          summary: newsSummary,
          content: newsContent,
          image_url: 'asset:news_liputan',
          author_name: 'Pembina NMC SMPN 2 Ciamis',
          published_at: publishedAt,
          is_featured: 0,
        };
      }
      if (getStoredToken()) {
        const res = await apiFetch<{ article: NewsArticle }>('/api/news', {
          method: 'POST',
          body: JSON.stringify({
            title: newsTitle,
            category: newsCategory,
            summary: newsSummary,
            content: newsContent,
          }),
        }).catch((err) => {
          if (!createdArticle) throw err;
          return null;
        });
        if (res && !createdArticle) createdArticle = res.article;
      }
      if (createdArticle) onNewsCreated(createdArticle);
      setNewsTitle('');
      setNewsSummary('');
      setNewsContent('');
      onToast('Artikel berita liputan berhasil diterbitkan di Beranda & Cloud.', 'success');
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
      let nextBranding: SiteBranding = {
        ...siteBranding,
        brandName: brandNameInput,
        footerAddress: footerAddressInput,
      };
      if (auth.currentUser && isFirebaseAdmin) {
        if (logoFile) {
          const uploaded = await uploadFileToCloud(logoFile, { isPublic: true, maxDimension: 800 });
          nextBranding = { ...nextBranding, logoUrl: uploaded.cloudUrl };
        }
        await saveSiteSettingsToFirestore(nextBranding);
        if (getStoredToken()) {
          const formData = new FormData();
          formData.append('brandName', brandNameInput);
          formData.append('footerAddress', footerAddressInput);
          if (logoFile) formData.append('logo', logoFile);
          void apiFetch('/api/admin/site-logo', { method: 'POST', body: formData }).catch(() => {});
        }
      } else if (getStoredToken()) {
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
        if (res?.siteSettings) {
          nextBranding = res.siteSettings;
        }
      } else {
        throw new Error('Masuk dengan akun Google Admin terlebih dahulu untuk mengunggah logo ke Cloud.');
      }

      onBrandingUpdated(nextBranding);
      if (logoPreviewUrl) {
        URL.revokeObjectURL(logoPreviewUrl);
      }
      setLogoFile(null);
      setLogoPreviewUrl('');
      onToast('Logo NMC, identitas header, dan teks footer berhasil disimpan ke Cloud.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memperbarui logo & footer.', 'error');
    } finally {
      setSavingBranding(false);
    }
  };

  const handleResetBranding = async () => {
    setSavingBranding(true);
    try {
      let nextBranding: SiteBranding = {
        ...siteBranding,
        brandName: 'Multimedia',
        logoUrl: '',
        footerAddress:
          'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215',
      };
      if (getStoredToken()) {
        const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/site-logo', {
          method: 'POST',
          body: JSON.stringify({ reset: 'true' }),
        }).catch(() => null);
        if (res?.siteSettings) nextBranding = res.siteSettings;
      }
      if (auth.currentUser && isFirebaseAdmin) {
        await saveSiteSettingsToFirestore(nextBranding);
      }
      onBrandingUpdated(nextBranding);
      setBrandNameInput(nextBranding.brandName);
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
      let nextBranding: SiteBranding = {
        ...siteBranding,
        socialLinks: socialLinksInput,
      };
      if (getStoredToken()) {
        const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/social-links', {
          method: 'POST',
          body: JSON.stringify({ socialLinks: socialLinksInput }),
        }).catch(() => null);
        if (res?.siteSettings) nextBranding = res.siteSettings;
      }
      if (auth.currentUser && isFirebaseAdmin) {
        await saveSiteSettingsToFirestore(nextBranding);
      }
      onBrandingUpdated(nextBranding);
      onToast('Ikon siluet dan tautan media sosial footer berhasil disimpan ke Cloud.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan media sosial.', 'error');
    } finally {
      setSavingSocial(false);
    }
  };

  const handleResetSocialLinks = async () => {
    setSavingSocial(true);
    try {
      const defaultSocial: SocialLinkItem[] = [
        { id: 'ig', platform: 'instagram', label: 'Instagram', url: 'https://instagram.com' },
        { id: 'tt', platform: 'tiktok', label: 'TikTok', url: 'https://tiktok.com' },
        { id: 'yt', platform: 'youtube', label: 'YouTube', url: 'https://youtube.com' },
      ];
      let nextBranding: SiteBranding = {
        ...siteBranding,
        socialLinks: defaultSocial,
      };
      if (getStoredToken()) {
        const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/social-links', {
          method: 'POST',
          body: JSON.stringify({ reset: true }),
        }).catch(() => null);
        if (res?.siteSettings) nextBranding = res.siteSettings;
      }
      if (auth.currentUser && isFirebaseAdmin) {
        await saveSiteSettingsToFirestore(nextBranding);
      }
      onBrandingUpdated(nextBranding);
      if (nextBranding.socialLinks) {
        setSocialLinksInput(nextBranding.socialLinks);
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
      let iconUrl = '';
      if (auth.currentUser && isFirebaseAdmin) {
        const uploaded = await uploadFileToCloud(file, { isPublic: true, maxDimension: 512 });
        iconUrl = uploaded.cloudUrl;
      } else if (getStoredToken()) {
        const fd = new FormData();
        fd.append('icon', file);
        const res = await apiFetch<{ iconUrl: string }>('/api/admin/social-icon', {
          method: 'POST',
          body: fd,
        });
        iconUrl = res.iconUrl;
      } else {
        throw new Error('Masuk dengan akun Google Admin terlebih dahulu untuk mengunggah ikon kustom.');
      }

      setSocialLinksInput((prev) =>
        prev.map((item) => (item.id === id ? { ...item, customIconUrl: iconUrl } : item))
      );
      onToast('Ikon siluet kustom berhasil diunggah ke Cloud. Klik Simpan Media Sosial untuk menerapkan.', 'success');
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
      let nextBranding: SiteBranding = {
        ...siteBranding,
        heroEyebrow: heroEyebrowInput,
        heroTitle: heroTitleInput,
        heroDescription: heroDescInput,
      };
      if (auth.currentUser && isFirebaseAdmin) {
        if (heroImageFile) {
          const uploaded = await uploadFileToCloud(heroImageFile, { isPublic: true, maxDimension: 1800 });
          nextBranding = { ...nextBranding, heroImageUrl: uploaded.cloudUrl };
        }
        await saveSiteSettingsToFirestore(nextBranding);
        if (getStoredToken()) {
          const formData = new FormData();
          formData.append('heroEyebrow', heroEyebrowInput);
          formData.append('heroTitle', heroTitleInput);
          formData.append('heroDescription', heroDescInput);
          if (heroImageFile) formData.append('heroImage', heroImageFile);
          void apiFetch('/api/admin/hero-settings', { method: 'POST', body: formData }).catch(() => {});
        }
      } else if (getStoredToken()) {
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
        if (res?.siteSettings) nextBranding = res.siteSettings;
      } else {
        throw new Error('Masuk dengan akun Google Admin terlebih dahulu untuk mengunggah foto hero ke Cloud.');
      }

      onBrandingUpdated(nextBranding);
      if (heroPreviewUrl) {
        URL.revokeObjectURL(heroPreviewUrl);
      }
      setHeroImageFile(null);
      setHeroPreviewUrl('');
      onToast('Tampilan Hero Beranda berhasil disimpan ke Cloud.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan Hero Beranda.', 'error');
    } finally {
      setSavingHero(false);
    }
  };

  const handleResetHero = async () => {
    setSavingHero(true);
    try {
      let nextBranding: SiteBranding = {
        ...siteBranding,
        heroEyebrow: 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi',
        heroTitle: 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis',
        heroDescription:
          'Wadah resmi siswa SMPN 2 Ciamis dalam bidang fotografi, videografi, penyiaran, desain grafis, dan jurnalistik sekolah—dilengkapi arsip karya digital serta sistem absensi kartu pelajar NFC/RFID dan QR Code secara real-time.',
        heroImageUrl: '',
      };
      if (getStoredToken()) {
        const res = await apiFetch<{ siteSettings: SiteBranding }>('/api/admin/hero-settings', {
          method: 'POST',
          body: JSON.stringify({ reset: 'true' }),
        }).catch(() => null);
        if (res?.siteSettings) nextBranding = res.siteSettings;
      }
      if (auth.currentUser && isFirebaseAdmin) {
        await saveSiteSettingsToFirestore(nextBranding);
      }
      onBrandingUpdated(nextBranding);
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
      let fileUrl = '';
      let fileName = file.name;
      if (auth.currentUser || canWriteCloudAdmin) {
        const uploaded = await uploadFileToCloud(file, {
          isPublic: true,
          uploaderMemberId: currentMemberId,
        });
        fileUrl = uploaded.cloudUrl;
        fileName = uploaded.fileName;
      } else if (getStoredToken()) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiFetch<{ fileUrl: string; fileName: string }>('/api/admin/tasks/upload-material', {
          method: 'POST',
          body: fd,
        });
        fileUrl = res.fileUrl;
        fileName = res.fileName;
      } else {
        throw new Error('Masuk sebagai Admin atau Pembina untuk mengunggah lampiran materi.');
      }

      setDraftStages((prev) =>
        prev.map((st) => (st.key === stageKey ? { ...st, attachment_url: fileUrl } : st))
      );
      onToast(`File materi "${fileName}" berhasil diunggah & dilampirkan ke Cloud.`, 'success');
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
      let createdTask: AdminLmsTask | null = null;
      if (auth.currentUser || canWriteCloudAdmin) {
        try {
          const fId = await createLmsTaskInFirestore({
            title: taskTitle.trim(),
            description: taskDesc.trim(),
            division: taskDivision,
            pointsReward: Number(taskPoints) || 100,
            dueDate: taskDueDate,
            creatorName: 'Pembina NMC',
            createdByMemberId: currentMemberId,
            stages: draftStages.map((s) => ({
              stage_type: s.stage_type,
              title: s.title,
              content: s.content,
              attachment_url: s.attachment_url,
            })),
          });
          const taskNumId = Date.now();
          createdTask = {
            id: taskNumId,
            firestoreId: fId,
            title: taskTitle.trim(),
            description: taskDesc.trim(),
            division: taskDivision,
            points_reward: Number(taskPoints) || 100,
            due_date: taskDueDate,
            is_published: 1,
            created_by: 0,
            creator_name: 'Pembina NMC',
            created_at: new Date().toISOString(),
            stages: draftStages.map((s, idx) => ({
              id: taskNumId + idx + 1,
              task_id: taskNumId,
              stage_order: idx + 1,
              stage_type: s.stage_type,
              title: s.title,
              content: s.content,
              attachment_url: s.attachment_url,
              created_at: new Date().toISOString(),
            })),
            submissions: [],
          };
        } catch (cloudErr) {
          if (!getStoredToken()) throw cloudErr;
        }
      }
      if (getStoredToken()) {
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
        }).catch((err) => {
          if (!createdTask) throw err;
          return null;
        });
        if (res?.task && !createdTask) createdTask = res.task;
      }
      if (createdTask) {
        setAdminTasks((prev) => [createdTask!, ...prev]);
      }
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

  const handleDeleteLmsTask = async (task: AdminLmsTask) => {
    try {
      if ((auth.currentUser || canWriteCloudAdmin) && task.firestoreId) {
        try {
          await deleteLmsTaskInFirestore(task.firestoreId);
        } catch (cloudErr) {
          if (!getStoredToken()) throw cloudErr;
        }
      }
      if (getStoredToken()) {
        await apiFetch(`/api/admin/tasks/${task.id}`, { method: 'DELETE' }).catch(() => {});
      }
      setAdminTasks((prev) => prev.filter((t) => t.id !== task.id));
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
      if ((auth.currentUser || canWriteCloudAdmin) && sub.firestoreId) {
        await reviewLmsSubmissionInFirestore({
          submissionId: sub.firestoreId,
          status,
          pointsAwarded: nextPoints,
          adminFeedback: feedback,
          actorMemberId: currentMemberId,
        });
      }
      if (getStoredToken()) {
        await apiFetch(`/api/admin/task-submissions/${sub.id}/review`, {
          method: 'POST',
          body: JSON.stringify({
            status,
            points_awarded: nextPoints,
            admin_feedback: feedback,
          }),
        }).catch(() => {});
      }
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
      let approvedWork: StudentWork | null = null;
      if ((auth.currentUser || canWriteCloudAdmin) && work.firestoreId) {
        await reviewWorkInFirestore(work.firestoreId, decision, note, currentMemberId);
        if (decision === 'approved') {
          approvedWork = { ...work, approval_status: 'approved', review_note: note };
        }
      }
      if (getStoredToken()) {
        const res = await apiFetch<{ work: StudentWork }>(`/api/admin/works/${work.id}/review`, {
          method: 'POST',
          body: JSON.stringify({ decision, note }),
        }).catch(() => null);
        if (res?.work && !approvedWork) approvedWork = res.work;
      }
      setPendingWorks((prev) => prev.filter((w) => w.id !== work.id));
      if (decision === 'approved' && approvedWork) {
        onWorkApproved(approvedWork);
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
                  <CloudVideo src={work.media_url} controls className="w-full h-full object-cover" />
                ) : (
                  <CloudImage
                    src={work.media_url}
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
              Kurasi Pembina · NMC SMPN 2 Ciamis
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
          Administrasi Ekstrakurikuler · NMC SMPN 2 Ciamis
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight mt-1">
          Panel Admin &amp; Pembina NMC
        </h1>
        <p className="text-sm text-slate-600 mt-1 max-w-2xl">
          Kelola 20 akun siswa, pembina, dan kartu NFC, tinjau persetujuan karya anggota, pantau kapasitas penyimpanan Firebase, serta atur liputan dan tampilan portal.
        </p>
      </div>

      {/* Cloud Storage Full / Warning Alert Banner */}
      {cloudStorage && (cloudStorage.status === 'warning' || cloudStorage.status === 'full') && (
        <div
          className={`rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            cloudStorage.status === 'full'
              ? 'bg-rose-50 border-rose-300 text-rose-950'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`w-5 h-5 shrink-0 mt-0.5 ${
                cloudStorage.status === 'full' ? 'text-rose-600' : 'text-amber-600'
              }`}
            />
            <div className="space-y-1">
              <p className="text-sm font-semibold">
                {cloudStorage.status === 'full'
                  ? `Peringatan: Penyimpanan File Firebase Sudah Penuh (${cloudStorage.usagePercent}%)`
                  : `Pemberitahuan: Penyimpanan File Firebase Hampir Penuh (${cloudStorage.usagePercent}%)`}
              </p>
              <p className="text-xs opacity-90">
                Terpakai{' '}
                <span className="font-mono font-semibold">
                  {formatBytes(cloudStorage.estimatedFirestoreBytes)}
                </span>{' '}
                dari kuota portal{' '}
                <span className="font-mono font-semibold">{formatBytes(cloudStorage.quotaBytes)}</span>{' '}
                ({cloudStorage.totalFiles} file tersimpan). Segera pilih dan hapus file karya/tugas lama agar pengunggahan siswa tetap lancar.
              </p>
            </div>
          </div>
          {tab !== 'database' && (
            <button
              type="button"
              onClick={() => setTab('database')}
              className={`px-4 py-2.5 text-xs font-semibold rounded-xl whitespace-nowrap shrink-0 text-white ${
                cloudStorage.status === 'full'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-amber-700 hover:bg-amber-800'
              }`}
            >
              Kelola &amp; Hapus File
            </button>
          )}
        </div>
      )}

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
          <button
            type="button"
            onClick={() => setTab('database')}
            className={`relative inline-flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'database'
                ? 'border-[#B91C1C] text-[#B91C1C] font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-4 h-4" />
            Database &amp; Penyimpanan
            {cloudStorage && cloudStorage.status !== 'ok' && (
              <span
                className={`w-2 h-2 rounded-full ${
                  cloudStorage.status === 'full' ? 'bg-rose-600' : 'bg-amber-500'
                }`}
              />
            )}
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          {tab === 'students' && (
            <div className="space-y-6">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-3">
                <div className="space-y-1">
                  <p className="font-semibold text-slate-900">
                    Total Peserta Terdaftar: {studentMembers.length} Siswa (+{members.length - studentMembers.length} Pembina)
                  </p>
                  <p>
                    Tambahkan akun anggota baru secara manual atau melalui fitur impor CSV/Excel di bawah. Untuk mendaftarkan UID kartu NFC/RFID dengan USB Reader, klik tombol edit pada siswa lalu tempelkan kartu ke USB Reader.
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

              {/* Export & Import Member Data Card */}
              <div className="border border-slate-200 rounded-xl p-5 space-y-4 bg-white">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Export &amp; Import Data Anggota (CSV / JSON)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Unduh seluruh data anggota untuk diedit di Excel/Sheets, atau import file CSV/JSON dengan opsi menimpa data lama berdasarkan username.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleExportMembers('csv')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV ({members.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportMembers('json')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-[#1D4ED8] border border-blue-200 rounded-xl transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Export JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportMembers('template')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Template CSV
                    </button>
                  </div>
                </div>

                {!isFirebaseAdmin && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <span>
                        {getStoredToken()
                          ? 'Import & penimpaan data anggota tersimpan ke server lokal Pembina. Hubungkan Google Admin ('
                          : 'Untuk menyinkronkan hasil import & penimpaan data anggota ke Cloud Firestore lintas perangkat, hubungkan akun Google Admin ('}
                        <span className="font-mono font-semibold">NedacisMC@gmail.com</span>
                        {getStoredToken()
                          ? ') bila ingin langsung menyinkronkan ke Cloud Firestore.'
                          : ').'}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={connectingGoogleAdmin}
                      onClick={async () => {
                        setConnectingGoogleAdmin(true);
                        try {
                          await signInWithGoogle();
                          onToast('Google Admin terhubung. Import siap disinkronkan ke Cloud.', 'success');
                        } catch (err) {
                          onToast(err instanceof Error ? err.message : 'Gagal menghubungkan Google Admin.', 'error');
                        } finally {
                          setConnectingGoogleAdmin(false);
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {connectingGoogleAdmin ? 'Menghubungkan...' : 'Hubungkan Google Admin'}
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  <div className="lg:col-span-7 space-y-2.5">
                    <p className="text-xs font-semibold text-slate-700">Mode Konflik Username Saat Import</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label
                        className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                          importOverwrite
                            ? 'bg-amber-50/70 border-amber-400 text-slate-900'
                            : 'bg-slate-50/50 border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="member-import-mode"
                          checked={importOverwrite}
                          onChange={() => setImportOverwrite(true)}
                          className="mt-0.5 accent-[#B91C1C]"
                        />
                        <div className="text-xs">
                          <p className="font-semibold text-slate-900">Timpa Data Lama</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Jika username sudah ada, seluruh profil (nama, NIS, kelas, divisi, NFC, QR) ditimpa dengan data baru.
                          </p>
                        </div>
                      </label>

                      <label
                        className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                          !importOverwrite
                            ? 'bg-blue-50/70 border-blue-400 text-slate-900'
                            : 'bg-slate-50/50 border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="member-import-mode"
                          checked={!importOverwrite}
                          onChange={() => setImportOverwrite(false)}
                          className="mt-0.5 accent-[#1D4ED8]"
                        />
                        <div className="text-xs">
                          <p className="font-semibold text-slate-900">Lewati yang Sudah Ada</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Hanya menambahkan anggota baru; data anggota lama dengan username sama tidak diubah.
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="lg:col-span-5 space-y-2.5">
                    <p className="text-xs font-semibold text-slate-700">Pilih File Import (.csv atau .json)</p>
                    <label className="flex flex-col items-center justify-center gap-1.5 p-4 border-2 border-dashed border-slate-300 hover:border-[#1D4ED8] rounded-xl bg-slate-50/60 hover:bg-blue-50/30 cursor-pointer transition-colors text-center">
                      <UploadCloud className="w-5 h-5 text-[#1D4ED8]" />
                      <span className="text-xs font-semibold text-slate-800">
                        {importRawFile ? importRawFile.name : 'Klik untuk pilih file CSV atau JSON'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Kolom kosong (mis. password/NFC) tetap mempertahankan nilai lama saat ditimpa
                      </span>
                      <input
                        ref={importFileInputRef}
                        type="file"
                        accept=".csv,.json,text/csv,application/json"
                        onChange={(e) => void handleImportFileSelected(e.target.files?.[0])}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>

                {importParseError && (
                  <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>{importParseError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearImport}
                      className="text-xs font-semibold text-rose-700 hover:underline shrink-0"
                    >
                      Tutup
                    </button>
                  </div>
                )}

                {importResultSummary && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>
                          Hasil Import: {importResultSummary.created} akun baru, {importResultSummary.updated} akun ditimpa, {importResultSummary.skipped} dilewati.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setImportResultSummary(null)}
                        className="text-[11px] font-semibold text-emerald-700 hover:underline"
                      >
                        Tutup
                      </button>
                    </div>
                    {importResultSummary.errors.length > 0 && (
                      <ul className="list-disc pl-5 text-rose-700 space-y-0.5">
                        {importResultSummary.errors.slice(0, 6).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {importPreview && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/40">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-100/80 border-b border-slate-200">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-900">
                          Pratinjau: {importPreview.fileName} ({importPreview.totalRows} baris)
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-semibold">
                          +{importPreview.createCount} Baru
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-semibold">
                          {importPreview.overwriteCount} Ditimpa
                        </span>
                        {importPreview.skipCount > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 font-semibold">
                            {importPreview.skipCount} Dilewati
                          </span>
                        )}
                        {importPreview.errorCount > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-semibold">
                            {importPreview.errorCount} Error
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleClearImport}
                          disabled={importingMembers}
                          className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={handleExecuteMemberImport}
                          disabled={
                            importingMembers ||
                            importPreview.createCount + importPreview.overwriteCount === 0
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 text-white rounded-lg"
                        >
                          {importingMembers ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Mengimport...
                            </>
                          ) : (
                            <>
                              <UploadCloud className="w-3.5 h-3.5" />
                              Jalankan Import ({importPreview.createCount + importPreview.overwriteCount})
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="max-h-64 overflow-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-white border-b border-slate-200 text-slate-600 sticky top-0">
                          <tr>
                            <th className="py-2 px-3">#</th>
                            <th className="py-2 px-3">Status</th>
                            <th className="py-2 px-3">Username</th>
                            <th className="py-2 px-3">Nama Lengkap</th>
                            <th className="py-2 px-3">Kelas &amp; Divisi</th>
                            <th className="py-2 px-3">UID NFC / QR</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {importPreview.rows.slice(0, 60).map((row) => (
                            <tr
                              key={`${row.rowNumber}-${row.data.username}`}
                              className={row.action === 'error' ? 'bg-rose-50/50' : ''}
                            >
                              <td className="py-2 px-3 text-slate-400 font-mono">{row.rowNumber}</td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {row.action === 'create' && (
                                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-semibold">
                                    Baru
                                  </span>
                                )}
                                {row.action === 'overwrite' && (
                                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-semibold">
                                    Timpa Data Lama
                                  </span>
                                )}
                                {row.action === 'skip' && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 font-semibold">
                                    Dilewati
                                  </span>
                                )}
                                {row.action === 'error' && (
                                  <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-semibold">
                                    Error
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-800">
                                {row.data.username || '-'}
                                {row.data.role === 'admin' && (
                                  <span className="ml-1.5 text-[10px] font-sans font-semibold text-[#B91C1C]">
                                    (Pembina)
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-slate-900">
                                <p className="font-medium">{row.data.full_name || '-'}</p>
                                {row.errors.length > 0 && (
                                  <p className="text-[11px] text-rose-700 mt-0.5">
                                    {row.errors.join(' ')}
                                  </p>
                                )}
                              </td>
                              <td className="py-2 px-3 text-slate-600">
                                {row.data.kelas} · {row.data.division}
                              </td>
                              <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                                {row.data.nfc_uid || '(auto)'} / {row.data.qr_code_token || '(auto)'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {importPreview.rows.length > 60 && (
                        <p className="p-2.5 text-center text-[11px] text-slate-500 bg-slate-50 border-t border-slate-200">
                          Menampilkan 60 baris pertama dari total {importPreview.rows.length} baris.
                        </p>
                      )}
                    </div>
                  </div>
                )}
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
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  <div className="sm:col-span-5">
                    <input
                      type="tel"
                      value={parentWhatsapp}
                      onChange={(e) => setParentWhatsapp(e.target.value)}
                      placeholder="No. WA Orang Tua (mis. 081234567890)"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    />
                  </div>
                  <div className="sm:col-span-4 flex items-center gap-2">
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
                      placeholder="UID NFC/RFID (opsional)"
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
                  <div className="sm:col-span-3 flex justify-end">
                    <button
                      type="submit"
                      disabled={creatingStudent || studentMembers.length >= 20}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 rounded-xl whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" />
                      {studentMembers.length >= 20 ? 'Kuota 20 Siswa Penuh' : 'Buat Akun Siswa'}
                    </button>
                  </div>
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
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      No. WhatsApp Orang Tua / Wali (untuk Laporan Otomatis Absen Masuk, Pulang &amp; Rekap Bulanan)
                    </label>
                    <input
                      type="tel"
                      value={editParentWhatsapp}
                      onChange={(e) => setEditParentWhatsapp(e.target.value)}
                      placeholder="Contoh: 081234567890 atau 6281234567890"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    />
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
                      <th className="py-3 px-4">No. WA Ortu</th>
                      <th className="py-3 px-4">UID NFC/RFID</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {members.map((m) => (
                      <tr key={m.firestoreId || `${m.id}-${m.username}`} className={editingId === m.id ? 'bg-blue-50/40' : ''}>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{m.full_name}</p>
                          <p className={`text-xs ${m.role === 'admin' ? 'font-medium text-[#B91C1C]' : 'text-slate-500'}`}>
                            {m.role === 'admin'
                              ? `Pembina · ${m.division} · ${m.nis}`
                              : `Kelas ${m.kelas} · ${m.division} · NIS ${m.nis}`}
                          </p>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700">{m.username}</td>
                        <td className="py-3 px-4 font-mono text-xs">
                          {m.parent_whatsapp ? (
                            <span className="text-emerald-700 font-medium">+{m.parent_whatsapp.replace(/^\+/, '')}</span>
                          ) : (
                            <span className="text-slate-400">Belum diisi</span>
                          )}
                        </td>
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
                              <CloudFileAttachment
                                url={st.attachment_url}
                                showPreview={false}
                                linkLabel="Lampiran Terpasang"
                                className="text-emerald-700 font-medium hover:underline"
                              />
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
                                onClick={() => handleDeleteLmsTask(t)}
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
                                        <CloudFileAttachment
                                          url={sub.file_url}
                                          fileName={sub.file_name}
                                          fileType={sub.file_type}
                                          showPreview={false}
                                          linkLabel={
                                            <>
                                              <FileText className="w-3.5 h-3.5" />
                                              {sub.file_name || 'Lihat / Unduh File Tugas'}
                                            </>
                                          }
                                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 rounded-lg"
                                        />
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
                      onClick={() => handleRemoveBlockedWord(bw)}
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
                  placeholder="Contoh: Tim NMC Liput Kejuaraan Lomba Pramuka Tingkat Kabupaten"
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
                    <CloudImage
                      src={heroPreviewUrl || siteBranding.heroImageUrl || HERO_IMAGE}
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
                          placeholder="https://instagram.com/nmc.smpn2ciamis"
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

          {tab === 'database' && (
            <div className="space-y-6">
              {/* Cloud Firestore Storage Quota & Selective File Manager */}
              <div className="border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5 bg-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <HardDrive className="w-4 h-4 text-[#B91C1C]" />
                      <h3 className="text-base font-semibold text-slate-900">
                        Manajemen Penyimpanan File Cloud Firebase
                      </h3>
                      {cloudStorage && (
                        <span
                          className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full ${
                            cloudStorage.status === 'full'
                              ? 'bg-rose-100 text-rose-800'
                              : cloudStorage.status === 'warning'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {cloudStorage.status === 'full'
                            ? 'Penuh (>=90%)'
                            : cloudStorage.status === 'warning'
                            ? 'Hampir Penuh (>=75%)'
                            : 'Kapasitas Aman'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">
                      Memantau seluruh foto, video, dan file tugas LMS yang diunggah ke Cloud Firestore (tidak memakai Google Drive). Pilih file tertentu untuk dihapus bila ruang penyimpanan mulai penuh.
                    </p>
                  </div>
                  {!isFirebaseAdmin && (
                    <button
                      type="button"
                      disabled={connectingGoogleAdmin}
                      onClick={handleConnectGoogleAdminForStorage}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-xl whitespace-nowrap shrink-0 disabled:opacity-60"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      {connectingGoogleAdmin ? 'Menghubungkan...' : 'Hubungkan Google Admin untuk Hapus File'}
                    </button>
                  )}
                </div>

                {cloudStorage ? (
                  <>
                    {/* Quota Meter Bar */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-slate-800">
                          Terpakai: {formatBytes(cloudStorage.estimatedFirestoreBytes)} /{' '}
                          {formatBytes(cloudStorage.quotaBytes)}{' '}
                          <span className="font-mono text-slate-500">
                            (Ukuran asli {formatBytes(cloudStorage.totalRawBytes)} · {cloudStorage.totalFiles} file)
                          </span>
                        </span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            cloudStorage.status === 'full'
                              ? 'text-rose-700'
                              : cloudStorage.status === 'warning'
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {cloudStorage.usagePercent}%
                        </span>
                      </div>
                      <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            cloudStorage.status === 'full'
                              ? 'bg-rose-600'
                              : cloudStorage.status === 'warning'
                              ? 'bg-amber-500'
                              : 'bg-emerald-600'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(2, cloudStorage.usagePercent))}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Estimasi menghitung ekspansi Base64 (~1,35x) di Firestore agar aman di dalam batas gratis 1 GiB Spark. Peringatan muncul otomatis pada 75% dan status penuh pada 90%.
                      </p>
                    </div>

                    {/* Filter & Quick-Select Controls */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[200px]">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={storageSearch}
                            onChange={(e) => setStorageSearch(e.target.value)}
                            placeholder="Cari nama file atau akun pengunggah..."
                            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                          />
                        </div>
                        <select
                          value={storageTypeFilter}
                          onChange={(e) =>
                            setStorageTypeFilter(e.target.value as 'all' | 'image' | 'video' | 'other')
                          }
                          className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl"
                        >
                          <option value="all">Semua Tipe ({cloudStorage.files.length})</option>
                          <option value="image">Gambar / Foto</option>
                          <option value="video">Video</option>
                          <option value="other">Dokumen / Lainnya</option>
                        </select>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteMode('none');
                            setSelectedFileIds(filteredStorageFiles.map((f) => f.fileId));
                          }}
                          disabled={filteredStorageFiles.length === 0}
                          className="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl"
                        >
                          Pilih Semua ({filteredStorageFiles.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteMode('none');
                            setSelectedFileIds(
                              filteredStorageFiles
                                .filter((f) => f.sizeBytes >= 1024 * 1024)
                                .map((f) => f.fileId)
                            );
                          }}
                          disabled={filteredStorageFiles.length === 0}
                          className="px-3 py-2 text-xs font-medium bg-amber-50 hover:bg-amber-100 border border-amber-200 disabled:opacity-50 text-amber-900 rounded-xl"
                        >
                          Pilih &gt; 1 MB
                        </button>
                        {selectedFileIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteMode('none');
                              setSelectedFileIds([]);
                            }}
                            className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl"
                          >
                            Batal Pilih
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bulk Delete Confirmation Bar */}
                    {selectedFileIds.length > 0 && (
                      <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-xs font-medium text-rose-900">
                          <span className="font-semibold">{selectedFileIds.length} file dipilih</span> · Perkiraan ruang yang dibebaskan:{' '}
                          <span className="font-mono font-semibold">{formatBytes(selectedEstimatedBytes)}</span>
                        </p>
                        {confirmDeleteMode === 'bulk' ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-rose-800">Hapus permanen?</span>
                            <button
                              type="button"
                              disabled={deletingStorageFiles}
                              onClick={handleBulkDeleteCloudFiles}
                              className="px-3.5 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg disabled:opacity-60"
                            >
                              {deletingStorageFiles ? 'Menghapus...' : 'Ya, Hapus Terpilih'}
                            </button>
                            <button
                              type="button"
                              disabled={deletingStorageFiles}
                              onClick={() => setConfirmDeleteMode('none')}
                              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (!isFirebaseAdmin) {
                                onToast(
                                  'Hubungkan akun Google Admin terlebih dahulu untuk menghapus file Cloud.',
                                  'error'
                                );
                                return;
                              }
                              setConfirmDeleteMode('bulk');
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl self-start sm:self-auto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Hapus Terpilih ({selectedFileIds.length})
                          </button>
                        )}
                      </div>
                    )}

                    {/* File List */}
                    {filteredStorageFiles.length === 0 ? (
                      <div className="border border-slate-200 rounded-xl p-8 text-center text-xs sm:text-sm text-slate-500">
                        {cloudStorage.files.length === 0
                          ? 'Belum ada file media atau lampiran yang tersimpan di Cloud Firebase.'
                          : 'Tidak ada file yang cocok dengan filter pencarian.'}
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                        {filteredStorageFiles.map((file) => {
                          const isChecked = selectedFileIds.includes(file.fileId);
                          const isImg = file.mimeType.startsWith('image/');
                          const isVid = file.mimeType.startsWith('video/');
                          return (
                            <div
                              key={file.fileId}
                              className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                                isChecked ? 'bg-blue-50/50' : 'hover:bg-slate-50/70'
                              }`}
                            >
                              <div className="flex items-start gap-3 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSelectFile(file.fileId)}
                                  aria-label={`Pilih ${file.fileName}`}
                                  className="mt-0.5 text-slate-500 hover:text-[#1D4ED8] shrink-0"
                                >
                                  {isChecked ? (
                                    <CheckSquare className="w-4 h-4 text-[#1D4ED8]" />
                                  ) : (
                                    <Square className="w-4 h-4" />
                                  )}
                                </button>
                                <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                                  {isImg ? (
                                    <ImageIcon className="w-4 h-4 text-[#1D4ED8]" />
                                  ) : isVid ? (
                                    <Video className="w-4 h-4 text-[#B91C1C]" />
                                  ) : (
                                    <FileIcon className="w-4 h-4 text-slate-600" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs sm:text-sm font-medium text-slate-900 truncate">
                                    {file.fileName}
                                  </p>
                                  <p className="text-[11px] text-slate-500 font-mono truncate">
                                    {formatBytes(file.estimatedFirestoreBytes)} Cloud (asli {formatBytes(file.sizeBytes)}) · {file.chunkCount} bagian · Pengunggah: {file.uploaderUid} · {formatTimeAgo(file.createdAt)}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadOrOpenMedia(
                                      `${CLOUD_FILE_PREFIX}${file.fileId}`,
                                      file.fileName
                                    ).catch((err) =>
                                      onToast(
                                        err instanceof Error ? err.message : 'Gagal membuka file.',
                                        'error'
                                      )
                                    )
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 rounded-lg"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  Lihat
                                </button>

                                {confirmDeleteMode === file.fileId ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={deletingStorageFiles}
                                      onClick={() => handleDeleteSingleCloudFile(file)}
                                      className="px-2.5 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg"
                                    >
                                      {deletingStorageFiles ? '...' : 'Hapus'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={deletingStorageFiles}
                                      onClick={() => setConfirmDeleteMode('none')}
                                      className="px-2 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg"
                                    >
                                      Batal
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!isFirebaseAdmin) {
                                        onToast(
                                          'Hubungkan akun Google Admin terlebih dahulu untuk menghapus file Cloud.',
                                          'error'
                                        );
                                        return;
                                      }
                                      setConfirmDeleteMode(file.fileId);
                                    }}
                                    title="Hapus file dari Cloud"
                                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-6 text-center text-xs text-slate-500 border border-slate-200 rounded-xl">
                    Memuat data penggunaan penyimpanan Cloud Firebase...
                  </div>
                )}
              </div>

              {/* Cloud Firestore Cross-Device Sync Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-blue-50/70 border border-blue-200 rounded-xl">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-[#1D4ED8]" />
                    Cloud Firestore Real-Time Sync ({isFirebaseAdmin ? 'Terhubung Admin Google' : 'Mode Pembina / Lokal'})
                  </p>
                  <p className="text-xs text-slate-600">
                    {isFirebaseAdmin
                      ? `Akun ${firebaseEmail || 'Admin Google'} aktif. Semua perubahan otomatis tersimpan di Cloud Firestore (${cloudSeeded ? 'Data Cloud Aktif' : 'Siap Disinkronkan'}) dan dapat diakses dari semua browser/perangkat.`
                      : 'Masuk dengan Google Admin (NedacisMC@gmail.com) untuk akses penuh pengaturan situs, PII siswa, dan penghapusan permanen file penyimpanan.'}
                  </p>
                </div>
                {onSyncCloudNow && isFirebaseAdmin && (
                  <button
                    type="button"
                    disabled={syncingCloud}
                    onClick={async () => {
                      setSyncingCloud(true);
                      try {
                        await onSyncCloudNow();
                      } finally {
                        setSyncingCloud(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#1D4ED8] hover:bg-[#1E40AF] text-white rounded-xl whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingCloud ? 'animate-spin' : ''}`} />
                    {syncingCloud ? 'Menyinkronkan...' : 'Sinkronkan ke Cloud Firestore'}
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-700" />
                    Penyimpanan SQLite Terproteksi (WAL + Synchronous FULL + Auto-Backup)
                  </p>
                  <p className="text-xs text-slate-600">
                    Setiap perubahan data dicatat dalam transaksi atomik, di-checkpoint ke berkas utama <span className="font-mono">.db</span>, dan dicadangkan otomatis secara berkala serta saat server berhenti.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={loadingDbHealth}
                  onClick={loadDbHealth}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDbHealth ? 'animate-spin' : ''}`} />
                  Periksa Status
                </button>
              </div>

              {dbHealth ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                      <p className="text-xs text-slate-500">Integritas Database</p>
                      <p className="text-lg font-semibold text-emerald-700 uppercase">
                        {dbHealth.integrity === 'ok' ? 'OK (Sehat)' : dbHealth.integrity}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">
                        {dbHealth.journalMode.toUpperCase()} · SYNC {dbHealth.synchronous}
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                      <p className="text-xs text-slate-500">Ukuran Berkas Utama (.db)</p>
                      <p className="text-lg font-semibold text-slate-900 font-mono tabular-nums">
                        {(dbHealth.dbBytes / 1024).toFixed(1)} KB
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">
                        WAL tertunda: {(dbHealth.walBytes / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                      <p className="text-xs text-slate-500">Backup Terverifikasi</p>
                      <p className="text-lg font-semibold text-slate-900 font-mono tabular-nums">
                        {dbHealth.lastBackupBytes > 0
                          ? `${(dbHealth.lastBackupBytes / 1024).toFixed(1)} KB`
                          : 'Belum ada'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {dbHealth.lastBackupAt ? formatTimeAgo(dbHealth.lastBackupAt) : 'Klik simpan sekarang'}
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                      <p className="text-xs text-slate-500">Total Rekaman Tersimpan</p>
                      <p className="text-lg font-semibold text-slate-900 font-mono tabular-nums">
                        {Object.values(dbHealth.counts).reduce((a, b) => a + b, 0)} baris
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {dbHealth.counts.users} akun · {dbHealth.counts.works} karya · {dbHealth.counts.attendance_records} absensi
                      </p>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Ringkasan Tabel Tersimpan
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
                      {[
                        ['Pengguna & Pembina', dbHealth.counts.users],
                        ['Karya Siswa', dbHealth.counts.works],
                        ['Catatan Absensi', dbHealth.counts.attendance_records],
                        ['Tugas LMS', dbHealth.counts.lms_tasks],
                        ['Pengumpulan LMS', dbHealth.counts.lms_task_submissions],
                        ['Berita Liputan', dbHealth.counts.news_articles],
                        ['Jadwal Kegiatan', dbHealth.counts.schedules],
                        ['Notifikasi', dbHealth.counts.notifications],
                        ['Pengaturan Situs', dbHealth.counts.site_settings],
                      ].map(([label, cnt]) => (
                        <div key={String(label)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-2">
                          <span className="text-slate-600 truncate">{label}</span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">{cnt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-sm text-slate-500 border border-slate-200 rounded-xl">
                  Memuat status kesehatan database...
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={runningCheckpoint}
                  onClick={async () => {
                    setRunningCheckpoint(true);
                    try {
                      const res = await apiFetch<{ health: DbHealthState }>('/api/admin/database/checkpoint', {
                        method: 'POST',
                      });
                      setDbHealth(res.health);
                      onToast('Database berhasil di-flush (WAL Truncate) dan backup terbaru dibuat.', 'success');
                    } catch (err) {
                      onToast(err instanceof Error ? err.message : 'Gagal menjalankan checkpoint database.', 'error');
                    } finally {
                      setRunningCheckpoint(false);
                    }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {runningCheckpoint ? 'Menyimpan...' : 'Flush WAL & Simpan Backup Sekarang'}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const token = getStoredToken();
                      const res = await fetch('/api/admin/database/export', {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      });
                      if (!res.ok) throw new Error('Gagal mengunduh berkas database.');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `nmc_smpn2_ciamis_backup_${new Date().toISOString().slice(0, 10)}.db`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                      onToast('Berkas backup SQLite (.db) berhasil diunduh.', 'success');
                    } catch (err) {
                      onToast(err instanceof Error ? err.message : 'Gagal mengunduh backup.', 'error');
                    }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl"
                >
                  <Download className="w-4 h-4" />
                  Unduh Backup SQLite (.db)
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const token = getStoredToken();
                      const res = await fetch('/api/admin/database/export-json', {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      });
                      if (!res.ok) throw new Error('Gagal mengunduh arsip JSON.');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `nmc_smpn2_ciamis_backup_${new Date().toISOString().slice(0, 10)}.json`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                      onToast('Arsip data lengkap (.json) berhasil diunduh.', 'success');
                    } catch (err) {
                      onToast(err instanceof Error ? err.message : 'Gagal mengunduh JSON.', 'error');
                    }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  <Download className="w-4 h-4" />
                  Unduh Arsip JSON
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
