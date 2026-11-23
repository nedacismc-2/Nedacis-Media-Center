import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Film,
  Image as ImageIcon,
  Link2,
  PenLine,
  Plus,
  QrCode,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import type { AttendanceRecord, LmsTask, StudentProfile, StudentWork } from '../types';
import { apiFetch, getStoredToken } from '../lib/api';
import { auth } from '../lib/firebase';
import { uploadFileToCloud } from '../lib/cloudFiles';
import { useFirebase } from '../context/FirebaseContext';
import { createWorkInFirestore, sanitizeDocId, updateMemberProfileInFirestore } from '../lib/firestoreSync';
import {
  extractGoogleDriveFileId,
  formatDateID,
  getInitials,
  getLocalTimeZoneLabel,
  normalizeWorkMediaUrl,
} from '../lib/mediaAssets';
import { CloudImage, CloudVideo } from './CloudMedia';
import { QrCodeDisplay } from './QrCodeDisplay';

interface MembersSectionProps {
  members: StudentProfile[];
  allWorks?: StudentWork[];
  allAttendance?: AttendanceRecord[];
  currentUser: StudentProfile | null;
  cloudSeeded?: boolean;
  lmsTasks?: LmsTask[];
  selectedUsername: string | null;
  onSelectUsername: (username: string | null) => void;
  onOpenWork: (work: StudentWork) => void;
  onOpenTasks?: (taskId?: number) => void;
  onUserUpdated: (user: StudentProfile) => void;
  onWorkApprovedOrAdminCreated: (work: StudentWork) => void;
  onWorkPendingCreated?: (work: StudentWork) => void;
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
  latestAttendanceEvent: AttendanceRecord | null;
}

const DIVISIONS = ['Semua', 'Pembina', 'Fotografi', 'Videografi', 'Jurnalistik', 'Desain Grafis', 'Penyiaran'];
const EDITABLE_DIVISIONS = ['Fotografi', 'Videografi', 'Jurnalistik', 'Desain Grafis', 'Penyiaran'];

export function MembersSection({
  members,
  allWorks = [],
  allAttendance = [],
  currentUser,
  cloudSeeded = false,
  lmsTasks = [],
  selectedUsername,
  onSelectUsername,
  onOpenWork,
  onOpenTasks,
  onUserUpdated,
  onWorkApprovedOrAdminCreated,
  onWorkPendingCreated,
  onToast,
  latestAttendanceEvent,
}: MembersSectionProps) {
  const { isFirebaseAdmin, updateCloudUserPhoto } = useFirebase();
  const [division, setDivision] = useState('Semua');
  const [query, setQuery] = useState('');

  const currentMemberDocId = currentUser?.firestoreId?.startsWith('member_')
    ? currentUser.firestoreId
    : currentUser?.username
    ? sanitizeDocId(`member_${currentUser.username}`)
    : undefined;

  // Selected profile data
  const [profileDetail, setProfileDetail] = useState<{
    member: StudentProfile;
    attendanceHistory: AttendanceRecord[];
    works: StudentWork[];
  } | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Collapsible attendance history
  const [attendanceExpanded, setAttendanceExpanded] = useState(true);

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Inline bio & division editing state
  const [editingProfile, setEditingProfile] = useState(false);
  const [editBio, setEditBio] = useState('');
  const [editDivision, setEditDivision] = useState('Fotografi');
  const [savingProfile, setSavingProfile] = useState(false);

  // Student work upload modal from profile
  const [showWorkModal, setShowWorkModal] = useState(false);
  const [workTitle, setWorkTitle] = useState('');
  const [workCategory, setWorkCategory] = useState('Fotografi');
  const [workDesc, setWorkDesc] = useState('');
  const [workSourceMode, setWorkSourceMode] = useState<'file' | 'link'>('file');
  const [workFile, setWorkFile] = useState<File | null>(null);
  const [workMediaUrl, setWorkMediaUrl] = useState('');
  const [workMediaType, setWorkMediaType] = useState<'image' | 'video'>('image');
  const [workPreviewUrl, setWorkPreviewUrl] = useState<string | null>(null);
  const [workLinkPreviewError, setWorkLinkPreviewError] = useState(false);
  const [uploadingWork, setUploadingWork] = useState(false);

  useEffect(() => {
    setEditingProfile(false);
  }, [selectedUsername]);

  useEffect(() => {
    if (!selectedUsername) {
      setProfileDetail(null);
      return;
    }
    let active = true;
    const cloudMember = members.find(
      (m) => m.username.toLowerCase() === selectedUsername.toLowerCase()
    );
    const cloudWorks = allWorks.filter(
      (w) => w.author_username.toLowerCase() === selectedUsername.toLowerCase()
    );
    const cloudAtt = allAttendance.filter(
      (a) => a.username.toLowerCase() === selectedUsername.toLowerCase()
    );

    if (cloudMember) {
      setProfileDetail({
        member: cloudMember,
        attendanceHistory: cloudAtt,
        works: cloudWorks,
      });
    } else {
      setLoadingProfile(true);
    }

    apiFetch<{ member: StudentProfile; attendanceHistory: AttendanceRecord[]; works: StudentWork[] }>(
      `/api/members/${encodeURIComponent(selectedUsername)}`
    )
      .then((res) => {
        if (!active) return;
        const mergedWorksMap = new Map<string, StudentWork>();
        for (const w of cloudWorks) {
          mergedWorksMap.set(w.media_url || w.firestoreId || String(w.id), w);
        }
        for (const sw of res.works || []) {
          const key = sw.media_url || String(sw.id);
          if (!mergedWorksMap.has(key)) {
            mergedWorksMap.set(key, sw);
          }
        }
        const mergedWorks = Array.from(mergedWorksMap.values()).sort((a, b) =>
          (b.created_at || '').localeCompare(a.created_at || '')
        );
        const preferredAvatar =
          (cloudMember?.avatar_url?.startsWith('cloudfile://') ? cloudMember.avatar_url : '') ||
          (res.member.avatar_url?.startsWith('cloudfile://') ? res.member.avatar_url : '') ||
          cloudMember?.avatar_url ||
          res.member.avatar_url ||
          '';
        setProfileDetail({
          member: cloudMember
            ? {
                ...res.member,
                ...cloudMember,
                avatar_url: preferredAvatar,
                nis: cloudMember.nis || res.member.nis,
              }
            : res.member,
          attendanceHistory: cloudAtt.length > 0 ? cloudAtt : res.attendanceHistory,
          works: mergedWorks,
        });
      })
      .catch(() => {
        if (active && !cloudMember) setProfileDetail(null);
      })
      .finally(() => {
        if (active) setLoadingProfile(false);
      });
    return () => {
      active = false;
    };
  }, [selectedUsername, currentUser?.id, members, allWorks, allAttendance]);

  // Real-time update of attendance history when student taps NFC or QR is scanned!
  useEffect(() => {
    if (!latestAttendanceEvent || !profileDetail) return;
    if (
      latestAttendanceEvent.user_id !== profileDetail.member.id &&
      latestAttendanceEvent.username !== profileDetail.member.username
    ) {
      return;
    }

    setProfileDetail((prev) => {
      if (!prev) return prev;
      const existsIdx = prev.attendanceHistory.findIndex(
        (r) => r.attendance_date === latestAttendanceEvent.attendance_date
      );
      const updatedHistory =
        existsIdx >= 0
          ? prev.attendanceHistory.map((r, i) => (i === existsIdx ? latestAttendanceEvent : r))
          : [latestAttendanceEvent, ...prev.attendanceHistory];
      return { ...prev, attendanceHistory: updatedHistory };
    });
  }, [latestAttendanceEvent, profileDetail?.member.id, profileDetail?.member.username]);

  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast('Foto profil harus berupa file gambar (JPG, PNG, atau WebP).', 'error');
      return;
    }

    setUploadingAvatar(true);
    try {
      const targetMemberId = profileDetail?.member.firestoreId || currentMemberDocId;
      let nextAvatarUrl = '';

      if (cloudSeeded && targetMemberId && targetMemberId.startsWith('member_')) {
        try {
          const uploaded = await uploadFileToCloud(file, {
            isPublic: true,
            maxDimension: 600,
            uploaderMemberId: currentMemberDocId,
          });
          nextAvatarUrl = uploaded.cloudUrl;
          await updateMemberProfileInFirestore(targetMemberId, { avatarUrl: nextAvatarUrl });

          if (auth.currentUser) {
            await updateCloudUserPhoto(nextAvatarUrl).catch(() => {});
          }
          if (getStoredToken()) {
            void apiFetch('/api/profile/avatar', {
              method: 'POST',
              body: JSON.stringify({ avatar_url: nextAvatarUrl }),
            }).catch(() => {});
          }
        } catch (cloudErr) {
          if (!getStoredToken()) throw cloudErr;
        }
      }

      if (!nextAvatarUrl && getStoredToken()) {
        const formData = new FormData();
        formData.append('avatar', file);
        const res = await apiFetch<{ user: StudentProfile }>('/api/profile/avatar', {
          method: 'POST',
          body: formData,
        });
        nextAvatarUrl = res.user.avatar_url || '';
      }

      if (!nextAvatarUrl) {
        throw new Error('Server cloud belum aktif. Masuk dengan koneksi aktif untuk mengunggah foto.');
      }

      const baseUser = currentUser || profileDetail?.member;
      const updatedUser: StudentProfile | null = baseUser
        ? { ...baseUser, avatar_url: nextAvatarUrl }
        : null;

      if (!updatedUser) {
        throw new Error('Gagal memperbarui profil pengguna.');
      }
      setProfileDetail((prev) => (prev ? { ...prev, member: updatedUser } : prev));
      onUserUpdated(updatedUser);
      onToast('Foto profil berhasil diperbarui & tersinkronisasi di semua perangkat.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memperbarui foto profil.', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfileInfo = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !profileDetail) return;
    setSavingProfile(true);
    try {
      const cleanBio = editBio.trim().slice(0, 300);
      const nextDivision = profileDetail.member.role === 'admin' ? profileDetail.member.division : editDivision;
      const targetMemberId = profileDetail.member.firestoreId || currentMemberDocId;

      if (cloudSeeded && targetMemberId && targetMemberId.startsWith('member_')) {
        await updateMemberProfileInFirestore(targetMemberId, {
          bio: cleanBio,
          ...(profileDetail.member.role !== 'admin' ? { division: nextDivision } : {}),
        });
      }

      if (getStoredToken()) {
        await apiFetch('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            bio: cleanBio,
            ...(profileDetail.member.role !== 'admin' ? { division: nextDivision } : {}),
          }),
        }).catch(() => {});
      }

      const updatedUser: StudentProfile = {
        ...profileDetail.member,
        bio: cleanBio,
        division: nextDivision,
      };
      setProfileDetail((prev) => (prev ? { ...prev, member: updatedUser } : prev));
      onUserUpdated(updatedUser);
      setEditingProfile(false);
      onToast('Profil berhasil diperbarui & tersimpan di server.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan pembaruan profil.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleWorkFileChange = (selected: File | null) => {
    setWorkFile(selected);
    if (workPreviewUrl) URL.revokeObjectURL(workPreviewUrl);
    if (selected) {
      setWorkPreviewUrl(URL.createObjectURL(selected));
      setWorkSourceMode('file');
      setWorkMediaUrl('');
      setWorkLinkPreviewError(false);
    } else {
      setWorkPreviewUrl(null);
    }
  };

  const handleWorkMediaUrlChange = (val: string) => {
    setWorkMediaUrl(val);
    setWorkLinkPreviewError(false);
    if (val.trim()) {
      setWorkSourceMode('link');
      if (workFile) handleWorkFileChange(null);
      if (extractGoogleDriveFileId(val)) {
        setWorkMediaType('image');
      }
    }
  };

  const handleProfileWorkUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onToast('Silakan masuk ke akun Anda terlebih dahulu.', 'error');
      return;
    }
    const useLink = workSourceMode === 'link' || (!workFile && Boolean(workMediaUrl.trim()));
    const cleanUrl = useLink ? workMediaUrl.trim() : '';
    const activeFile = useLink ? null : workFile;

    if ((!activeFile && !cleanUrl) || !workTitle.trim()) {
      onToast('Judul dan file foto/video atau link gambar Google Drive wajib diisi.', 'error');
      return;
    }
    if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) {
      onToast('Tautan media harus diawali dengan https:// atau http://.', 'error');
      return;
    }

    setUploadingWork(true);
    try {
      const mediaType: 'image' | 'video' = activeFile
        ? activeFile.type.startsWith('video/')
          ? 'video'
          : 'image'
        : workMediaType;
      let resolvedUrl = cleanUrl ? normalizeWorkMediaUrl(cleanUrl, mediaType) : '';
      const pendingApproval = !(currentUser.role === 'admin' || isFirebaseAdmin);
      let createdWork: StudentWork | null = null;

      if (cloudSeeded) {
        try {
          if (activeFile) {
            const uploaded = await uploadFileToCloud(activeFile, {
              isPublic: true,
              uploaderMemberId: currentMemberDocId,
            });
            resolvedUrl = uploaded.cloudUrl;
          }

          if (resolvedUrl) {
            const fId = await createWorkInFirestore({
              title: workTitle.trim(),
              description: workDesc.trim(),
              category: workCategory,
              mediaType,
              mediaUrl: resolvedUrl,
              authorName: currentUser.full_name,
              authorUsername: currentUser.username,
              authorMemberId: currentMemberDocId,
              authorKelas: currentUser.kelas,
              authorDivision: currentUser.division,
              authorAvatarColor: currentUser.avatar_color,
              authorAvatarUrl: currentUser.avatar_url || '',
              isAdminUploader: !pendingApproval,
            });

            createdWork = {
              id: Date.now(),
              firestoreId: fId,
              authorUid: currentMemberDocId || auth.currentUser?.uid,
              user_id: currentUser.id,
              author_name: currentUser.full_name,
              author_username: currentUser.username,
              author_kelas: currentUser.kelas,
              author_division: currentUser.division,
              author_avatar_color: currentUser.avatar_color,
              author_avatar_url: currentUser.avatar_url,
              title: workTitle.trim(),
              description: workDesc.trim(),
              category: workCategory,
              media_type: mediaType,
              media_url: resolvedUrl,
              shares_count: 0,
              comments_disabled: 0,
              approval_status: pendingApproval ? 'pending' : 'approved',
              created_at: new Date().toISOString(),
              likes_count: 0,
              comments_count: 0,
              liked_by_me: false,
              comments: [],
            };

            if (getStoredToken()) {
              void apiFetch('/api/works', {
                method: 'POST',
                body: JSON.stringify({
                  title: workTitle.trim(),
                  category: workCategory,
                  description: workDesc.trim(),
                  media_url: resolvedUrl,
                  media_type: mediaType,
                }),
              }).catch(() => {});
            }
          }
        } catch (cloudErr) {
          if (!getStoredToken()) throw cloudErr;
        }
      }

      if (!createdWork && getStoredToken()) {
        if (activeFile) {
          const formData = new FormData();
          formData.append('title', workTitle.trim());
          formData.append('category', workCategory);
          formData.append('description', workDesc.trim());
          formData.append('media', activeFile);
          const res = await apiFetch<{ work: StudentWork }>('/api/works', {
            method: 'POST',
            body: formData,
          });
          createdWork = res.work;
        } else if (resolvedUrl) {
          const res = await apiFetch<{ work: StudentWork }>('/api/works', {
            method: 'POST',
            body: JSON.stringify({
              title: workTitle.trim(),
              category: workCategory,
              description: workDesc.trim(),
              media_url: resolvedUrl,
              media_type: mediaType,
            }),
          });
          createdWork = res.work;
        }
      }

      if (!createdWork) {
        throw new Error('Gagal mengunggah karya ke server.');
      }

      setProfileDetail((prev) => (prev ? { ...prev, works: [createdWork!, ...prev.works] } : prev));
      if (!pendingApproval) {
        onWorkApprovedOrAdminCreated(createdWork);
      } else {
        onWorkPendingCreated?.(createdWork);
      }
      setShowWorkModal(false);
      setWorkTitle('');
      setWorkDesc('');
      setWorkMediaUrl('');
      setWorkLinkPreviewError(false);
      setWorkSourceMode('file');
      handleWorkFileChange(null);
      onToast(
        pendingApproval
          ? 'Karya berhasil dikirim ke server & tersinkronisasi! Menunggu peninjauan Admin sebelum terposting di Beranda.'
          : 'Karya berhasil diterbitkan ke Beranda dan Galeri.',
        'success'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengunggah karya.', 'error');
    } finally {
      setUploadingWork(false);
    }
  };

  // Individual Student Profile View (also opened directly via QR Code URL)
  if (selectedUsername) {
    if (loadingProfile) {
      return (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-sm text-slate-500">
          Memuat profil anggota...
        </div>
      );
    }

    if (!profileDetail) {
      return (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4">
          <p className="text-sm text-slate-600">Profil anggota tidak ditemukan.</p>
          <button
            type="button"
            onClick={() => onSelectUsername(null)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali ke Daftar Anggota
          </button>
        </div>
      );
    }

    const { member, attendanceHistory, works } = profileDetail;
    const isOwnProfile = Boolean(
      currentUser && (currentUser.id === member.id || currentUser.username === member.username)
    );
    const profileQrUrl = `${window.location.origin}/#profil/${member.username}`;
    const hadirCount = attendanceHistory.filter((a) => a.status === 'Hadir' || a.status === 'Terlambat').length;

    return (
      <div className="space-y-8">
        <button
          type="button"
          onClick={() => onSelectUsername(null)}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl min-h-[42px]"
        >
          <ArrowLeft className="w-4 h-4" />
          Semua Anggota ({members.length})
        </button>

        {/* Top Profile & QR Card */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="relative w-20 h-20 shrink-0">
                  {member.avatar_url ? (
                    <CloudImage
                      src={member.avatar_url}
                      alt={member.full_name}
                      className="w-20 h-20 rounded-2xl object-cover border border-slate-200"
                    />
                  ) : (
                    <div
                      className="w-20 h-20 rounded-2xl text-white text-2xl font-semibold flex items-center justify-center"
                      style={{ backgroundColor: member.avatar_color || '#C81E1E' }}
                    >
                      {getInitials(member.full_name)}
                    </div>
                  )}

                  {isOwnProfile && (
                    <label
                      title="Ubah Foto Profil"
                      className="absolute -bottom-2 -right-2 w-8 h-8 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white flex items-center justify-center shadow-md cursor-pointer border-2 border-white transition-colors"
                    >
                      <Camera className="w-4 h-4" />
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingAvatar}
                        className="hidden"
                        onChange={handleAvatarChange}
                      />
                    </label>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-[#C81E1E]">
                    {member.role === 'admin'
                      ? `Pembina Ekstrakurikuler · Divisi ${member.division}`
                      : `Divisi ${member.division} · Kelas ${member.kelas}`}
                  </p>
                  <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-slate-900">
                    {member.full_name}
                  </h1>
                  <p className="text-xs font-mono text-slate-500">
                    @{member.username} · {member.nis ? (member.role === 'admin' ? member.nis : `NIS ${member.nis}`) : `ID ${member.qr_code_token}`}
                  </p>
                  {isOwnProfile && (
                    <label className="inline-flex items-center gap-1.5 pt-1 text-xs font-semibold text-[#1D4ED8] hover:underline cursor-pointer">
                      <Camera className="w-3.5 h-3.5" />
                      {uploadingAvatar ? 'Mengunggah foto...' : 'Ubah Foto Profil'}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingAvatar}
                        className="hidden"
                        onChange={handleAvatarChange}
                      />
                    </label>
                  )}
                </div>
              </div>

              {isOwnProfile && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditBio(member.bio || '');
                      setEditDivision(
                        EDITABLE_DIVISIONS.includes(member.division) ? member.division : 'Fotografi'
                      );
                      setEditingProfile((v) => !v);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors min-h-[44px] whitespace-nowrap"
                  >
                    <PenLine className="w-4 h-4" />
                    Edit Profil
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWorkModal(true)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl transition-colors min-h-[44px] whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    Unggah Karya
                  </button>
                </div>
              )}
            </div>

            {isOwnProfile && editingProfile ? (
              <form onSubmit={handleSaveProfileInfo} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                {member.role !== 'admin' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Divisi Fokus</label>
                    <select
                      value={editDivision}
                      onChange={(e) => setEditDivision(e.target.value)}
                      className="w-full sm:w-64 px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    >
                      {EDITABLE_DIVISIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bio / Minat Media Siswa</label>
                  <textarea
                    rows={3}
                    maxLength={300}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="Ceritakan minat Anda di fotografi, videografi, penyiaran, atau jurnalistik..."
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingProfile(false)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-xl"
                  >
                    {savingProfile ? 'Menyimpan...' : 'Simpan Profil'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed">{member.bio}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/70">
                <p className="text-xs text-slate-500">Total Kehadiran</p>
                <p className="mt-1 text-sm font-mono font-semibold text-slate-900 tabular-nums flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  {hadirCount} Sesi Tercatat
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/70">
                <p className="text-xs text-slate-500">Karya Terunggah</p>
                <p className="mt-1 text-sm font-mono font-semibold text-slate-900 tabular-nums">
                  {works.length} Karya
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/70">
                <p className="text-xs text-slate-500">Total Poin LMS</p>
                <p className="mt-1 text-sm font-mono font-semibold text-[#1D4ED8] tabular-nums flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-[#CA8A04]" />
                  {member.lms_points ?? 0} Poin
                </p>
              </div>
            </div>
          </div>

          {/* QR Code Panel */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col items-center text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
              QR Code Profil &amp; Absensi
            </p>
            <QrCodeDisplay
              value={profileQrUrl}
              label={member.full_name}
              sublabel={member.qr_code_token}
              size={168}
              downloadFileName={`qr-${member.username}`}
            />
            <p className="mt-3 text-xs text-slate-500 leading-relaxed">
              Pindai QR Code ini untuk membuka profil siswa secara langsung atau mencatat kehadiran melalui scanner Pembina.
            </p>
          </div>
        </div>

        {/* Collapsible Transparent Attendance History */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5">
          <div
            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              attendanceExpanded ? 'border-b border-slate-100 pb-4' : ''
            }`}
          >
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Riwayat Kehadiran Transparan</h2>
              <p className="text-xs text-slate-500">
                Tercatat otomatis secara real-time saat tap kartu pelajar NFC/RFID atau scan QR Code
              </p>
            </div>
            <div className="flex items-center gap-3 self-start sm:self-center">
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {attendanceHistory.length} entri kehadiran
              </span>
              <button
                type="button"
                aria-expanded={attendanceExpanded}
                aria-label={attendanceExpanded ? 'Sembunyikan Riwayat Kehadiran' : 'Tampilkan Riwayat Kehadiran'}
                onClick={() => setAttendanceExpanded((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors min-h-[36px]"
              >
                <span>{attendanceExpanded ? 'Sembunyikan' : 'Tampilkan'}</span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${
                    attendanceExpanded ? 'rotate-180' : 'rotate-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {attendanceExpanded && (
            <>
              {attendanceHistory.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  Belum ada riwayat kehadiran yang tercatat.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                        <th className="py-3 pr-4">Tanggal</th>
                        <th className="py-3 px-4">Jam Masuk</th>
                        <th className="py-3 px-4">Jam Pulang</th>
                        <th className="py-3 px-4">Kegiatan</th>
                        <th className="py-3 px-4">Metode</th>
                        <th className="py-3 pl-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {attendanceHistory.map((row) => (
                        <tr key={`${row.id}-${row.attendance_date}`} className="hover:bg-slate-50/70">
                          <td className="py-3 pr-4 whitespace-nowrap text-slate-700 font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              {formatDateID(row.attendance_date)}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-700 tabular-nums">
                            {row.check_in_time} {getLocalTimeZoneLabel()}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-xs tabular-nums">
                            {row.check_out_time ? (
                              <span className="text-indigo-700 font-medium">
                                {row.check_out_time} {getLocalTimeZoneLabel()}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-800">{row.session_title}</td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs font-mono text-slate-600">
                            <span>{row.method}</span>
                            {row.check_out_method && row.check_out_method !== row.method && (
                              <span className="text-slate-400"> / {row.check_out_method}</span>
                            )}
                          </td>
                          <td className="py-3 pl-4 whitespace-nowrap text-right font-medium">
                            <span
                              className={
                                row.status === 'Hadir'
                                  ? 'text-emerald-700'
                                  : row.status === 'Terlambat'
                                  ? 'text-amber-700'
                                  : row.status === 'Tanpa Keterangan'
                                  ? 'text-rose-700'
                                  : 'text-sky-700'
                              }
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Own LMS Tasks Card */}
        {isOwnProfile && onOpenTasks && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Tugas Belajar LMS Saya</h2>
                <p className="text-xs text-slate-500">
                  Selesaikan tahapan materi hingga unggah tugas akhir untuk meraih poin keaktifan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenTasks()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl whitespace-nowrap self-start sm:self-center"
              >
                <BookOpen className="w-4 h-4" />
                Buka Menu Tugas ({lmsTasks.length})
              </button>
            </div>

            {lmsTasks.length === 0 ? (
              <p className="text-sm text-slate-500 py-2">Belum ada tugas LMS yang ditugaskan saat ini.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lmsTasks.map((task) => {
                  const doneCount = task.progress.length;
                  const subStatus = task.submission?.status;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpenTasks(task.id)}
                      className="text-left p-4 border border-slate-200 hover:border-[#1D4ED8] rounded-xl transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                          Tahap {doneCount}/{task.stages.length} · +{task.points_reward} Poin ·{' '}
                          <span
                            className={
                              subStatus === 'approved' || subStatus === 'submitted'
                                ? 'text-emerald-700 font-semibold'
                                : subStatus === 'revision'
                                ? 'text-amber-700 font-semibold'
                                : 'text-[#B91C1C] font-medium'
                            }
                          >
                            {subStatus === 'approved'
                              ? 'Disetujui'
                              : subStatus === 'submitted'
                              ? 'Selesai Dikirim'
                              : subStatus === 'revision'
                              ? 'Perlu Revisi'
                              : 'Kerjakan'}
                          </span>
                        </p>
                        <p className="text-sm font-semibold text-slate-900 truncate">{task.title}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Works by Student */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Portofolio Karya ({works.length})</h2>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setShowWorkModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
              >
                <Plus className="w-4 h-4" />
                Unggah Karya Baru
              </button>
            )}
          </div>

          {works.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              {isOwnProfile
                ? 'Anda belum mengunggah karya. Gunakan tombol "Unggah Karya" untuk mengirim foto atau video ke peninjauan Admin.'
                : 'Siswa ini belum memiliki karya yang diterbitkan di galeri.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {works.map((work) => {
                const status = work.approval_status || 'approved';
                return (
                  <button
                    key={work.id}
                    type="button"
                    onClick={() => {
                      if (status === 'approved') {
                        onOpenWork(work);
                      } else if (status === 'pending') {
                        onToast('Karya ini sedang menunggu peninjauan dan persetujuan Admin sebelum tampil di Beranda.', 'info');
                      } else {
                        onToast(
                          work.review_note
                            ? `Karya ditolak: ${work.review_note}`
                            : 'Karya belum disetujui Admin untuk tayang di Beranda.',
                          'error'
                        );
                      }
                    }}
                    className="text-left bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-slate-300 transition-colors"
                  >
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      {work.media_type === 'video' ? (
                        <CloudVideo src={work.media_url} className="w-full h-full object-cover" muted />
                      ) : (
                        <CloudImage
                          src={work.media_url}
                          alt={work.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-4 space-y-1.5">
                      <p className="text-xs text-slate-500">
                        {work.category} · {formatDateID(work.created_at)}
                      </p>
                      <h3 className="text-sm font-semibold text-slate-900 line-clamp-2">{work.title}</h3>
                      {status === 'pending' && (
                        <p className="text-xs font-medium text-amber-700 flex items-center gap-1 pt-0.5">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          Menunggu peninjauan &amp; persetujuan Admin
                        </p>
                      )}
                      {status === 'rejected' && (
                        <p className="text-xs font-medium text-rose-700 flex items-center gap-1 pt-0.5">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          Perlu revisi{work.review_note ? `: ${work.review_note}` : ''}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Upload Work Modal for Logged-In Member */}
        {showWorkModal && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowWorkModal(false)}
          >
            <div
              className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Unggah Karya Anggota</h2>
                  <p className="text-xs text-slate-500">
                    Karya akan ditinjau dan disetujui Admin sebelum terposting di Beranda
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWorkModal(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleProfileWorkUpload} className="p-6 space-y-4">

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Judul Karya</label>
                  <input
                    type="text"
                    required
                    value={workTitle}
                    onChange={(e) => setWorkTitle(e.target.value)}
                    placeholder="Contoh: Liputan Kegiatan P5 SMPN 2 Ciamis"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Kategori Karya</label>
                  <select
                    value={workCategory}
                    onChange={(e) => setWorkCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  >
                    <option value="Fotografi">Fotografi</option>
                    <option value="Videografi">Videografi</option>
                    <option value="Desain Grafis">Desain Grafis</option>
                    <option value="Liputan">Liputan</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Deskripsi</label>
                  <textarea
                    rows={3}
                    value={workDesc}
                    onChange={(e) => setWorkDesc(e.target.value)}
                    placeholder="Jelaskan kegiatan atau proses pembuatan karya..."
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-medium text-slate-700">
                      Sumber Media Karya
                    </label>
                    <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setWorkSourceMode('file')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          workSourceMode === 'file'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        Upload File
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkSourceMode('link')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          workSourceMode === 'link'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        Link Google Drive / URL
                      </button>
                    </div>
                  </div>

                  {workSourceMode === 'file' ? (
                    <>
                      <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-slate-300 rounded-xl p-5 cursor-pointer hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3 text-slate-500">
                          <ImageIcon className="w-5 h-5" />
                          <Film className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium text-slate-700 text-center">
                          {workFile ? workFile.name : 'Klik untuk memilih foto atau video (maks 15MB)'}
                        </span>
                        <input
                          type="file"
                          accept="image/*,video/*"
                          className="hidden"
                          onChange={(e) => handleWorkFileChange(e.target.files?.[0] || null)}
                        />
                      </label>

                      {workPreviewUrl && workFile && (
                        <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 max-h-48">
                          {workFile.type.startsWith('video/') ? (
                            <video src={workPreviewUrl} controls className="w-full max-h-48 object-contain" />
                          ) : (
                            <img src={workPreviewUrl} alt="Pratinjau karya" className="w-full max-h-48 object-cover" />
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-8">
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Tautan Gambar Google Drive atau URL Media (HTTPS)
                          </label>
                          <input
                            type="url"
                            value={workMediaUrl}
                            onChange={(e) => handleWorkMediaUrlChange(e.target.value)}
                            placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Jenis Media
                          </label>
                          <select
                            value={workMediaType}
                            onChange={(e) => setWorkMediaType(e.target.value as 'image' | 'video')}
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                          >
                            <option value="image">Foto / Gambar</option>
                            <option value="video">Video</option>
                          </select>
                        </div>
                      </div>

                      {extractGoogleDriveFileId(workMediaUrl) ? (
                        <p className="flex items-start gap-1.5 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>
                            Link Google Drive terdeteksi. Pastikan izin file di Google Drive diatur ke <strong>Siapa saja yang memiliki link (Viewer)</strong> agar foto muncul otomatis.
                          </span>
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          Tempel link berbagi gambar dari Google Drive atau URL gambar HTTPS langsung.
                        </p>
                      )}

                      {workMediaUrl.trim() && /^https?:\/\//i.test(workMediaUrl.trim()) && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-medium text-slate-600">Pratinjau Otomatis:</p>
                          <div className="rounded-xl overflow-hidden border border-slate-200 bg-white max-h-48 flex items-center justify-center">
                            {workMediaType === 'video' ? (
                              <CloudVideo
                                src={normalizeWorkMediaUrl(workMediaUrl, 'video')}
                                controls
                                className="w-full max-h-48 object-contain"
                              />
                            ) : (
                              <CloudImage
                                src={normalizeWorkMediaUrl(workMediaUrl, 'image')}
                                alt="Pratinjau tautan gambar"
                                className="w-full max-h-48 object-cover"
                                onImageLoadSuccess={() => setWorkLinkPreviewError(false)}
                                onImageLoadFailed={() => setWorkLinkPreviewError(true)}
                              />
                            )}
                          </div>
                          {workLinkPreviewError && (
                            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                              Gambar belum dapat dimuat di pratinjau. Pastikan akses link di Google Drive diatur ke <strong>Siapa saja yang memiliki link</strong>.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowWorkModal(false)}
                    className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl min-h-[44px]"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={uploadingWork}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-xl min-h-[44px]"
                  >
                    {uploadingWork ? 'Mengirim...' : 'Kirim untuk Peninjauan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Directory Grid (Pembina + Registered Students)
  const filteredMembers = members.filter((m) => {
    const isVisibleMember = m.role === 'student' || m.show_in_members === 1;
    if (!isVisibleMember) return false;
    const matchDiv =
      division === 'Semua' ||
      (division === 'Pembina' ? m.role === 'admin' : m.division === division);
    const q = query.trim().toLowerCase();
    const matchQ =
      !q ||
      m.full_name.toLowerCase().includes(q) ||
      m.kelas.toLowerCase().includes(q) ||
      m.nis.includes(q) ||
      m.qr_code_token.toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q);
    return matchDiv && matchQ;
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[#C81E1E]">
            Direktori Anggota Resmi
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-slate-900">
            Profil Pembina &amp; Peserta Didik Terdaftar
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Klik profil pembina maupun anggota siswa untuk melihat QR Code identitas, portofolio karya, serta riwayat kehadiran.
          </p>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama, kelas, atau NIS..."
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
          />
        </div>
      </div>

      {/* Division Filter Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto max-w-full w-fit">
        {DIVISIONS.map((div) => (
          <button
            key={div}
            type="button"
            onClick={() => setDivision(div)}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
              division === div ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {div}
          </button>
        ))}
      </div>

      {/* 3-Column Student Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredMembers.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => onSelectUsername(member.username)}
            className="text-left bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-6 transition-colors flex flex-col justify-between gap-5 group"
          >
            <div className="flex items-start gap-4">
              {member.avatar_url ? (
                <CloudImage
                  src={member.avatar_url}
                  alt={member.full_name}
                  className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div
                  className="w-16 h-16 rounded-xl text-white text-lg font-semibold flex items-center justify-center shrink-0"
                  style={{ backgroundColor: member.avatar_color || '#1D4ED8' }}
                >
                  {getInitials(member.full_name)}
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <p className={`text-xs font-medium ${member.role === 'admin' ? 'text-[#B91C1C]' : 'text-slate-500'}`}>
                  {member.role === 'admin'
                    ? `Pembina · Divisi ${member.division}`
                    : `${member.division} · Kelas ${member.kelas}`}
                </p>
                <h3 className="text-base font-semibold text-slate-900 group-hover:text-[#1D4ED8] transition-colors truncate">
                  {member.full_name}
                </h3>
                <p className="text-xs font-mono text-slate-500 tabular-nums">
                  {member.nis ? (member.role === 'admin' ? member.nis : `NIS ${member.nis}`) : `ID ${member.qr_code_token}`}
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">{member.bio}</p>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono tabular-nums">
                Hadir:{' '}
                {Math.max(
                  member.attendance_count ?? 0,
                  allAttendance.filter(
                    (a) =>
                      a.username.toLowerCase() === member.username.toLowerCase() &&
                      (a.status === 'Hadir' || a.status === 'Terlambat')
                  ).length
                )}{' '}
                · Karya:{' '}
                {Math.max(
                  member.works_count ?? 0,
                  allWorks.filter((w) => w.author_username.toLowerCase() === member.username.toLowerCase()).length
                )}{' '}
                · Poin: {member.lms_points ?? 0}
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-[#1D4ED8]">
                <QrCode className="w-3.5 h-3.5" />
                Profil &amp; QR
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
