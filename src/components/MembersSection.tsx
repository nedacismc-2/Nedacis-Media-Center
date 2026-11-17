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
import { createWorkInFirestore, updateMemberAvatarInFirestore } from '../lib/firestoreSync';
import { formatDateID, getInitials, getLocalTimeZoneLabel } from '../lib/mediaAssets';
import { CloudImage, CloudVideo } from './CloudMedia';
import { QrCodeDisplay } from './QrCodeDisplay';

interface MembersSectionProps {
  members: StudentProfile[];
  allWorks?: StudentWork[];
  allAttendance?: AttendanceRecord[];
  currentUser: StudentProfile | null;
  lmsTasks?: LmsTask[];
  selectedUsername: string | null;
  onSelectUsername: (username: string | null) => void;
  onOpenWork: (work: StudentWork) => void;
  onOpenTasks?: (taskId?: number) => void;
  onUserUpdated: (user: StudentProfile) => void;
  onWorkApprovedOrAdminCreated: (work: StudentWork) => void;
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
  latestAttendanceEvent: AttendanceRecord | null;
}

const DIVISIONS = ['Semua', 'Pembina', 'Fotografi', 'Videografi', 'Jurnalistik', 'Desain Grafis', 'Penyiaran'];

export function MembersSection({
  members,
  allWorks = [],
  allAttendance = [],
  currentUser,
  lmsTasks = [],
  selectedUsername,
  onSelectUsername,
  onOpenWork,
  onOpenTasks,
  onUserUpdated,
  onWorkApprovedOrAdminCreated,
  onToast,
  latestAttendanceEvent,
}: MembersSectionProps) {
  const { firebaseUser, isFirebaseAdmin, signInWithGoogle, updateCloudUserPhoto } = useFirebase();
  const [division, setDivision] = useState('Semua');
  const [query, setQuery] = useState('');
  const [connectingGoogle, setConnectingGoogle] = useState(false);

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

  // Student work upload modal from profile
  const [showWorkModal, setShowWorkModal] = useState(false);
  const [workTitle, setWorkTitle] = useState('');
  const [workCategory, setWorkCategory] = useState('Fotografi');
  const [workDesc, setWorkDesc] = useState('');
  const [workFile, setWorkFile] = useState<File | null>(null);
  const [workPreviewUrl, setWorkPreviewUrl] = useState<string | null>(null);
  const [uploadingWork, setUploadingWork] = useState(false);

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
        setProfileDetail({
          member: cloudMember ? { ...res.member, ...cloudMember, nis: cloudMember.nis || res.member.nis } : res.member,
          attendanceHistory: cloudAtt.length > 0 ? cloudAtt : res.attendanceHistory,
          works: cloudWorks.length > 0 ? cloudWorks : res.works,
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
      let updatedUser: StudentProfile | null = null;
      if (auth.currentUser) {
        const uploaded = await uploadFileToCloud(file, { isPublic: true, maxDimension: 600 });
        await updateCloudUserPhoto(uploaded.cloudUrl);

        const canUpdateMemberDoc = Boolean(
          profileDetail?.member.firestoreId &&
            (isFirebaseAdmin || profileDetail.member.owner_uid === auth.currentUser.uid)
        );
        if (canUpdateMemberDoc && profileDetail?.member.firestoreId) {
          await updateMemberAvatarInFirestore(profileDetail.member.firestoreId, uploaded.cloudUrl).catch(
            () => {}
          );
        }

        if (getStoredToken()) {
          const formData = new FormData();
          formData.append('avatar', file);
          void apiFetch('/api/profile/avatar', { method: 'POST', body: formData }).catch(() => {});
        }

        const baseUser = currentUser || profileDetail?.member;
        if (baseUser) {
          updatedUser = { ...baseUser, avatar_url: uploaded.cloudUrl };
        }
      } else if (getStoredToken()) {
        const formData = new FormData();
        formData.append('avatar', file);
        const res = await apiFetch<{ user: StudentProfile }>('/api/profile/avatar', {
          method: 'POST',
          body: formData,
        });
        updatedUser = res.user;
      }

      if (!updatedUser) {
        throw new Error(
          'Hubungkan akun Google terlebih dahulu agar foto profil dapat diunggah dan tersinkron di semua perangkat.'
        );
      }
      setProfileDetail((prev) => (prev ? { ...prev, member: updatedUser! } : prev));
      onUserUpdated(updatedUser);
      onToast('Foto profil berhasil diperbarui dan disinkronkan.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memperbarui foto profil.', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleWorkFileChange = (selected: File | null) => {
    setWorkFile(selected);
    if (workPreviewUrl) URL.revokeObjectURL(workPreviewUrl);
    setWorkPreviewUrl(selected ? URL.createObjectURL(selected) : null);
  };

  const handleProfileWorkUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!workFile || !workTitle.trim()) {
      onToast('Judul dan file foto/video karya wajib diisi.', 'error');
      return;
    }
    setUploadingWork(true);
    try {
      let createdWork: StudentWork | null = null;
      let pendingApproval = currentUser?.role !== 'admin';

      if (auth.currentUser && currentUser) {
        const uploaded = await uploadFileToCloud(workFile, { isPublic: true });
        const mediaType: 'image' | 'video' = workFile.type.startsWith('video/') ? 'video' : 'image';
        const fId = await createWorkInFirestore({
          title: workTitle.trim(),
          description: workDesc.trim(),
          category: workCategory,
          mediaType,
          mediaUrl: uploaded.cloudUrl,
          authorName: currentUser.full_name,
          authorUsername: currentUser.username,
          authorKelas: currentUser.kelas,
          authorDivision: currentUser.division,
          authorAvatarColor: currentUser.avatar_color,
          authorAvatarUrl: currentUser.avatar_url || '',
          isAdminUploader: currentUser.role === 'admin',
        });

        pendingApproval = currentUser.role !== 'admin';
        createdWork = {
          id: Date.now(),
          firestoreId: fId,
          authorUid: auth.currentUser.uid,
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
          media_url: uploaded.cloudUrl,
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
          const mirrorForm = new FormData();
          mirrorForm.append('title', workTitle.trim());
          mirrorForm.append('category', workCategory);
          mirrorForm.append('description', workDesc.trim());
          mirrorForm.append('media', workFile);
          void apiFetch('/api/works', { method: 'POST', body: mirrorForm }).catch(() => {});
        }
      } else if (getStoredToken()) {
        const formData = new FormData();
        formData.append('title', workTitle.trim());
        formData.append('category', workCategory);
        formData.append('description', workDesc.trim());
        formData.append('media', workFile);

        const res = await apiFetch<{ work: StudentWork; pendingApproval?: boolean }>('/api/works', {
          method: 'POST',
          body: formData,
        });
        createdWork = res.work;
        pendingApproval = Boolean(res.pendingApproval);
      } else {
        throw new Error(
          'Hubungkan akun Google terlebih dahulu untuk mengunggah karya agar tersinkron ke semua perangkat.'
        );
      }

      if (createdWork) {
        setProfileDetail((prev) => (prev ? { ...prev, works: [createdWork!, ...prev.works] } : prev));
        if (!pendingApproval) {
          onWorkApprovedOrAdminCreated(createdWork);
        }
      }
      setShowWorkModal(false);
      setWorkTitle('');
      setWorkDesc('');
      handleWorkFileChange(null);
      onToast(
        pendingApproval
          ? 'Karya berhasil diunggah! Menunggu peninjauan dan persetujuan Admin sebelum terposting di Beranda.'
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
                <button
                  type="button"
                  onClick={() => setShowWorkModal(true)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl transition-colors min-h-[44px] whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Unggah Karya
                </button>
              )}
            </div>

            <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed">{member.bio}</p>

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
                        <th className="py-3 px-4">Waktu Masuk</th>
                        <th className="py-3 px-4">Kegiatan</th>
                        <th className="py-3 px-4">Metode</th>
                        <th className="py-3 pl-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {attendanceHistory.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/70">
                          <td className="py-3 pr-4 whitespace-nowrap text-slate-700 font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              {formatDateID(row.attendance_date)}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-600 tabular-nums">
                            {row.check_in_time} {getLocalTimeZoneLabel()}
                          </td>
                          <td className="py-3 px-4 text-slate-800">{row.session_title}</td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs font-mono text-slate-600">
                            {row.method}
                          </td>
                          <td className="py-3 pl-4 whitespace-nowrap text-right font-medium">
                            <span
                              className={
                                row.status === 'Hadir'
                                  ? 'text-emerald-700'
                                  : row.status === 'Terlambat'
                                  ? 'text-amber-700'
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
                {!firebaseUser && (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <p className="text-xs text-amber-900 leading-relaxed">
                      Hubungkan akun Google agar file foto/video tersimpan ke Cloud &amp; tampil di semua perangkat.
                    </p>
                    <button
                      type="button"
                      disabled={connectingGoogle}
                      onClick={async () => {
                        setConnectingGoogle(true);
                        try {
                          await signInWithGoogle();
                          onToast('Akun Google terhubung! File akan otomatis tersimpan ke Cloud.', 'success');
                        } catch (err) {
                          onToast(err instanceof Error ? err.message : 'Gagal menghubungkan Google.', 'error');
                        } finally {
                          setConnectingGoogle(false);
                        }
                      }}
                      className="px-3 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg whitespace-nowrap shrink-0"
                    >
                      {connectingGoogle ? 'Menghubungkan...' : 'Hubungkan Google'}
                    </button>
                  </div>
                )}

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

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Pilih File Foto atau Video (maks 15MB)
                  </label>
                  <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-slate-300 rounded-xl p-5 cursor-pointer hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3 text-slate-500">
                      <ImageIcon className="w-5 h-5" />
                      <Film className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-slate-700 text-center">
                      {workFile ? workFile.name : 'Klik untuk memilih foto atau video'}
                    </span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(e) => handleWorkFileChange(e.target.files?.[0] || null)}
                    />
                  </label>

                  {workPreviewUrl && workFile && (
                    <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 max-h-48">
                      {workFile.type.startsWith('video/') ? (
                        <video src={workPreviewUrl} controls className="w-full max-h-48 object-contain" />
                      ) : (
                        <img src={workPreviewUrl} alt="Pratinjau karya" className="w-full max-h-48 object-cover" />
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
                Hadir: {member.attendance_count ?? 0} · Karya: {member.works_count ?? 0} · Poin: {member.lms_points ?? 0}
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
