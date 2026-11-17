import { useEffect, useState, type FormEvent } from 'react';
import {
  Heart,
  MessageSquare,
  Share2,
  Plus,
  Trash2,
  Lock,
  Unlock,
  Send,
  X,
  Image as ImageIcon,
  Film,
  AlertCircle,
} from 'lucide-react';
import type { StudentProfile, StudentWork, WorkComment } from '../types';
import { apiFetch, getStoredToken } from '../lib/api';
import { auth } from '../lib/firebase';
import { uploadFileToCloud } from '../lib/cloudFiles';
import {
  addWorkCommentInFirestore,
  createWorkInFirestore,
  deleteWorkCommentInFirestore,
  deleteWorkInFirestore,
  fetchWorkLikedByUser,
  sanitizeDocId,
  shareWorkInFirestore,
  subscribeWorkComments,
  toggleWorkCommentsInFirestore,
  toggleWorkLikeInFirestore,
} from '../lib/firestoreSync';
import { formatTimeAgo, getInitials } from '../lib/mediaAssets';
import { CloudImage, CloudVideo } from './CloudMedia';

interface GallerySectionProps {
  works: StudentWork[];
  currentUser: StudentProfile | null;
  selectedWork: StudentWork | null;
  onSelectWork: (work: StudentWork | null) => void;
  onOpenMemberProfile: (username: string) => void;
  onRequireLogin: () => void;
  onWorkCreated: (work: StudentWork) => void;
  onWorkDeleted: (id: number) => void;
  onWorkPatch: (id: number, patch: Partial<StudentWork>) => void;
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

const CATEGORIES = ['Semua', 'Fotografi', 'Videografi', 'Desain Grafis', 'Liputan'];

export function GallerySection({
  works,
  currentUser,
  selectedWork,
  onSelectWork,
  onOpenMemberProfile,
  onRequireLogin,
  onWorkCreated,
  onWorkDeleted,
  onWorkPatch,
  onToast,
}: GallerySectionProps) {
  const [filter, setFilter] = useState('Semua');
  const [showUploadModal, setShowUploadModal] = useState(false);

  const memberDocId = currentUser?.firestoreId?.startsWith('member_')
    ? currentUser.firestoreId
    : currentUser?.username
    ? sanitizeDocId(`member_${currentUser.username}`)
    : undefined;
  const effectiveActorId = auth.currentUser?.uid || memberDocId;

  // Upload state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Fotografi');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrlInput, setMediaUrlInput] = useState('');
  const [mediaTypeInput, setMediaTypeInput] = useState<'image' | 'video'>('image');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Comment state
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [cloudComments, setCloudComments] = useState<WorkComment[] | null>(null);

  useEffect(() => {
    const fId = selectedWork?.firestoreId;
    if (!fId) {
      setCloudComments(null);
      return;
    }
    const unsub = subscribeWorkComments(fId, currentUser?.role === 'admin', (comments) => {
      setCloudComments(comments);
    });
    if (effectiveActorId) {
      fetchWorkLikedByUser(fId, memberDocId).then((liked) => {
        if (liked && !selectedWork.liked_by_me) {
          onWorkPatch(selectedWork.id, { liked_by_me: true });
        }
      });
    }
    return () => unsub();
  }, [selectedWork?.firestoreId, selectedWork?.id, currentUser?.role, effectiveActorId, memberDocId]);

  const filteredWorks = filter === 'Semua' ? works : works.filter((w) => w.category === filter);

  const handleFileChange = (selected: File | null) => {
    setFile(selected);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (selected) {
      setPreviewUrl(URL.createObjectURL(selected));
    } else {
      setPreviewUrl(null);
    }
  };

  const handleUploadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireLogin();
      return;
    }
    const cleanUrl = mediaUrlInput.trim();
    if ((!file && !cleanUrl) || !title.trim()) {
      onToast('Judul dan file atau tautan URL media wajib dilengkapi.', 'error');
      return;
    }

    setUploading(true);
    try {
      let resolvedMediaUrl = cleanUrl;
      let resolvedMediaType: 'image' | 'video' = mediaTypeInput;
      let createdWork: StudentWork | null = null;
      let pendingApproval = currentUser.role !== 'admin';

      if (file) {
        resolvedMediaType = file.type.startsWith('video/') ? 'video' : 'image';
        const uploaded = await uploadFileToCloud(file, {
          isPublic: true,
          uploaderMemberId: memberDocId,
        });
        resolvedMediaUrl = uploaded.cloudUrl;
      }

      if (resolvedMediaUrl) {
        const fId = await createWorkInFirestore({
          title: title.trim(),
          description: description.trim(),
          category,
          mediaType: resolvedMediaType,
          mediaUrl: resolvedMediaUrl,
          authorName: currentUser.full_name,
          authorUsername: currentUser.username,
          authorMemberId: memberDocId,
          authorKelas: currentUser.kelas,
          authorDivision: currentUser.division,
          authorAvatarColor: currentUser.avatar_color,
          authorAvatarUrl: currentUser.avatar_url || '',
          isAdminUploader: currentUser.role === 'admin',
        });

        createdWork = {
          id: Date.now(),
          firestoreId: fId,
          authorUid: effectiveActorId || memberDocId,
          user_id: currentUser.id,
          author_name: currentUser.full_name,
          author_username: currentUser.username,
          author_kelas: currentUser.kelas,
          author_division: currentUser.division,
          author_avatar_color: currentUser.avatar_color,
          author_avatar_url: currentUser.avatar_url,
          title: title.trim(),
          description: description.trim(),
          category,
          media_type: resolvedMediaType,
          media_url: resolvedMediaUrl,
          shares_count: 0,
          comments_disabled: 0,
          approval_status: currentUser.role === 'admin' ? 'approved' : 'pending',
          created_at: new Date().toISOString(),
          likes_count: 0,
          comments_count: 0,
          liked_by_me: false,
          comments: [],
        };

        if (getStoredToken()) {
          const mirrorForm = new FormData();
          mirrorForm.append('title', title.trim());
          mirrorForm.append('category', category);
          mirrorForm.append('description', description.trim());
          if (file) mirrorForm.append('media', file);
          void apiFetch('/api/works', { method: 'POST', body: mirrorForm }).catch(() => {});
        }
      }

      if (!pendingApproval && createdWork) {
        onWorkCreated(createdWork);
      }
      setShowUploadModal(false);
      setTitle('');
      setDescription('');
      setMediaUrlInput('');
      handleFileChange(null);
      onToast(
        pendingApproval
          ? 'Karya berhasil dikirim ke Firebase! Menunggu peninjauan Admin sebelum terposting di Beranda.'
          : 'Karya berhasil diterbitkan dan tersinkronisasi di Beranda & Galeri.',
        'success'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengunggah karya.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleLike = async (work: StudentWork) => {
    if (!currentUser) {
      onRequireLogin();
      return;
    }
    try {
      if (work.firestoreId) {
        const liked = await toggleWorkLikeInFirestore(work.firestoreId, work.likes_count, memberDocId);
        const nextCount = liked ? work.likes_count + 1 : Math.max(0, work.likes_count - 1);
        onWorkPatch(work.id, { liked_by_me: liked, likes_count: nextCount });
      }
      if (getStoredToken()) {
        const res = await apiFetch<{ liked: boolean; likes_count: number }>(`/api/works/${work.id}/like`, {
          method: 'POST',
        }).catch(() => null);
        if (res && !work.firestoreId) {
          onWorkPatch(work.id, { liked_by_me: res.liked, likes_count: res.likes_count });
        }
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memproses suka.', 'error');
    }
  };

  const handleShare = async (work: StudentWork) => {
    try {
      const shareUrl = `${window.location.origin}/#karya/${work.id}`;
      if (navigator.share) {
        await navigator.share({
          title: work.title,
          text: `Lihat karya ${work.author_name} di Nedacis Media Center SMPN 2 Ciamis`,
          url: shareUrl,
        }).catch(() => {});
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      }
      if (work.firestoreId && effectiveActorId) {
        await shareWorkInFirestore(work.firestoreId, work.shares_count, effectiveActorId);
        onWorkPatch(work.id, { shares_count: work.shares_count + 1 });
      }
      if (getStoredToken()) {
        const res = await apiFetch<{ shares_count: number }>(`/api/works/${work.id}/share`, {
          method: 'POST',
        }).catch(() => null);
        if (res && !work.firestoreId) {
          onWorkPatch(work.id, { shares_count: res.shares_count });
        }
      }
      onToast('Tautan karya disalin untuk dibagikan.', 'success');
    } catch {
      onToast('Tautan karya disalin.', 'info');
    }
  };

  const handleCommentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedWork) return;
    if (!currentUser) {
      onRequireLogin();
      return;
    }
    if (!commentText.trim()) return;

    setSubmittingComment(true);
    setCommentError(null);
    try {
      if (selectedWork.firestoreId) {
        const createdComment = await addWorkCommentInFirestore({
          workId: selectedWork.firestoreId,
          currentCommentsCount: selectedWork.comments_count,
          authorName: currentUser.full_name,
          authorUsername: currentUser.username,
          authorMemberId: memberDocId,
          authorKelas: currentUser.kelas,
          authorRole: currentUser.role,
          content: commentText.trim(),
        });
        setCloudComments((prev) => (prev ? [...prev, createdComment] : [createdComment]));
      }
      if (getStoredToken()) {
        await apiFetch(`/api/works/${selectedWork.id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ content: commentText.trim() }),
        }).catch((err) => {
          if (!selectedWork.firestoreId) throw err;
        });
      }
      setCommentText('');
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Komentar tidak dapat dikirim.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleToggleComments = async (work: StudentWork) => {
    try {
      const nextDisabled = work.comments_disabled ? 0 : 1;
      if (work.firestoreId) {
        await toggleWorkCommentsInFirestore(work.firestoreId, nextDisabled === 1, memberDocId);
      }
      if (getStoredToken()) {
        await apiFetch<{ comments_disabled: number }>(`/api/works/${work.id}/comments-toggle`, {
          method: 'PATCH',
        }).catch(() => {});
      }
      onWorkPatch(work.id, { comments_disabled: nextDisabled });
      onToast(
        nextDisabled ? 'Komentar dinonaktifkan untuk karya ini.' : 'Komentar diaktifkan kembali.',
        'info'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengubah status komentar.', 'error');
    }
  };

  const handleDeleteWork = async (work: StudentWork) => {
    try {
      if (work.firestoreId) {
        await deleteWorkInFirestore(work.firestoreId);
      }
      if (getStoredToken()) {
        await apiFetch(`/api/works/${work.id}`, { method: 'DELETE' }).catch(() => {});
      }
      onWorkDeleted(work.id);
      if (selectedWork?.id === work.id) onSelectWork(null);
      onToast('Konten karya telah dihapus.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus karya.', 'error');
    }
  };

  const handleDeleteComment = async (comment: WorkComment) => {
    try {
      if (selectedWork?.firestoreId && comment.firestoreId) {
        await deleteWorkCommentInFirestore(
          selectedWork.firestoreId,
          comment.firestoreId,
          selectedWork.comments_count
        );
      }
      if (getStoredToken()) {
        await apiFetch(`/api/comments/${comment.id}`, { method: 'DELETE' }).catch(() => {});
      }
      setCloudComments((prev) => (prev ? prev.filter((c) => c.id !== comment.id) : prev));
      onToast('Komentar telah dihapus oleh admin.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus komentar.', 'error');
    }
  };

  return (
    <div className="space-y-8">
      {/* Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[#C81E1E]">
            Galeri &amp; Dokumentasi Karya
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-slate-900">
            Hasil Karya Fotografi &amp; Video Siswa
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Ruang publikasi dan diskusi edukatif untuk karya dokumentasi peserta ekstrakurikuler NMC SMPN 2 Ciamis.
          </p>
        </div>

        <button
          type="button"
          onClick={() => (currentUser ? setShowUploadModal(true) : onRequireLogin())}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl transition-colors min-h-[44px] whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Unggah Karya Siswa
        </button>
      </div>

      {/* Interactive Category Filter */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto max-w-full w-fit">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
              filter === cat ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Gallery Grid */}
      {filteredWorks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500 text-sm">
          Belum ada karya pada kategori {filter}.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredWorks.map((work) => (
            <article
              key={work.id}
              className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between"
            >
              <div>
                <div
                  onClick={() => {
                    setCommentError(null);
                    onSelectWork(work);
                  }}
                  className="relative aspect-[4/3] bg-slate-100 overflow-hidden cursor-pointer group"
                >
                  {work.media_type === 'video' ? (
                    <CloudVideo
                      src={work.media_url}
                      controls
                      preload="metadata"
                      className="w-full h-full object-cover"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <CloudImage
                      src={work.media_url}
                      alt={work.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                    />
                  )}
                </div>

                <div className="p-5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {work.category} · {work.media_type === 'video' ? 'Video' : 'Foto'} · {formatTimeAgo(work.created_at)}
                    </span>
                    {work.comments_disabled === 1 && (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                        <Lock className="w-3 h-3" />
                        Komentar nonaktif
                      </span>
                    )}
                  </div>

                  <h3
                    onClick={() => {
                      setCommentError(null);
                      onSelectWork(work);
                    }}
                    className="text-base font-semibold text-slate-900 leading-snug cursor-pointer hover:text-[#1D4ED8] transition-colors"
                  >
                    {work.title}
                  </h3>

                  <p className="text-sm text-slate-600 line-clamp-2">{work.description}</p>

                  <button
                    type="button"
                    onClick={() => onOpenMemberProfile(work.author_username)}
                    className="pt-1 inline-flex items-center gap-2 text-left group"
                  >
                    {work.author_avatar_url ? (
                      <CloudImage
                        src={work.author_avatar_url}
                        alt={work.author_name}
                        className="w-7 h-7 rounded-full object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <span
                        className="w-7 h-7 rounded-full text-white text-[11px] font-semibold flex items-center justify-center shrink-0"
                        style={{ backgroundColor: work.author_avatar_color || '#1D4ED8' }}
                      >
                        {getInitials(work.author_name)}
                      </span>
                    )}
                    <span className="text-xs font-medium text-slate-700 group-hover:text-[#1D4ED8]">
                      {work.author_name} · Kelas {work.author_kelas}
                    </span>
                  </button>
                </div>
              </div>

              {/* Social Action Bar */}
              <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleLike(work)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium min-h-[40px] transition-colors ${
                      work.liked_by_me
                        ? 'text-rose-600 bg-rose-50'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${work.liked_by_me ? 'fill-current' : ''}`} />
                    <span className="font-mono tabular-nums">{work.likes_count}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCommentError(null);
                      onSelectWork(work);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 min-h-[40px] transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span className="font-mono tabular-nums">{work.comments_count}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleShare(work)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 min-h-[40px] transition-colors"
                  >
                    <Share2 className="w-4 h-4" />
                    <span className="font-mono tabular-nums">{work.shares_count}</span>
                  </button>
                </div>

                {(currentUser?.role === 'admin' ||
                  currentUser?.id === work.user_id ||
                  currentUser?.username === work.author_username ||
                  (auth.currentUser && work.authorUid === auth.currentUser.uid)) && (
                  <button
                    type="button"
                    onClick={() => handleDeleteWork(work)}
                    title="Hapus konten karya"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowUploadModal(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Unggah Karya Foto atau Video</h2>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="p-6 space-y-4">

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Judul Karya</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: Dokumentasi Upacara Hari Pahlawan SMPN 2 Ciamis"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Kategori Karya</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                >
                  <option value="Fotografi">Fotografi</option>
                  <option value="Videografi">Videografi</option>
                  <option value="Desain Grafis">Desain Grafis</option>
                  <option value="Liputan">Liputan</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Deskripsi Kegiatan</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ceritakan proses pengambilan gambar, teknik kamera, atau momen kegiatan..."
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Pilih File Media (Gambar JPG/PNG/WebP atau Video MP4/WebM, maks 15MB)
                </label>
                <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-slate-300 rounded-xl p-6 cursor-pointer hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3 text-slate-500">
                    <ImageIcon className="w-5 h-5" />
                    <Film className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-medium text-slate-700 text-center">
                    {file ? file.name : 'Klik untuk memilih foto atau video dari perangkat'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  />
                </label>

                {previewUrl && file && (
                  <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 max-h-48">
                    {file.type.startsWith('video/') ? (
                      <video src={previewUrl} controls className="w-full max-h-48 object-contain" />
                    ) : (
                      <img src={previewUrl} alt="Pratinjau karya" className="w-full max-h-48 object-cover" />
                    )}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-8">
                    <input
                      type="url"
                      value={mediaUrlInput}
                      onChange={(e) => setMediaUrlInput(e.target.value)}
                      placeholder="Atau tempel URL foto/video HTTPS (opsional)"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <select
                      value={mediaTypeInput}
                      onChange={(e) => setMediaTypeInput(e.target.value as 'image' | 'video')}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                    >
                      <option value="image">Foto / Gambar</option>
                      <option value="video">Video</option>
                    </select>
                  </div>
                </div>
              </div>

              {currentUser?.role !== 'admin' && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                  Karya yang diunggah siswa akan masuk ke antrean peninjauan Admin dan otomatis tampil di Beranda setelah disetujui.
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl min-h-[44px]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-xl min-h-[44px]"
                >
                  {uploading
                    ? 'Mengunggah...'
                    : currentUser?.role === 'admin'
                    ? 'Terbitkan Karya'
                    : 'Kirim untuk Peninjauan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Work & Healthy Discussion Modal */}
      {selectedWork && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={() => onSelectWork(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-5xl w-full max-h-[92vh] overflow-hidden grid grid-cols-1 lg:grid-cols-12 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left Media Viewport */}
            <div className="lg:col-span-7 bg-slate-950 flex items-center justify-center min-h-[260px] lg:min-h-[540px] max-h-[50vh] lg:max-h-[92vh]">
              {selectedWork.media_type === 'video' ? (
                <CloudVideo
                  src={selectedWork.media_url}
                  controls
                  autoPlay
                  className="w-full h-full max-h-[85vh] object-contain"
                />
              ) : (
                <CloudImage
                  src={selectedWork.media_url}
                  alt={selectedWork.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full max-h-[85vh] object-contain"
                />
              )}
            </div>

            {/* Right Metadata, Moderation & Discussion */}
            <div className="lg:col-span-5 flex flex-col max-h-[42vh] lg:max-h-[92vh] bg-white">
              <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">
                    {selectedWork.category} · {formatTimeAgo(selectedWork.created_at)}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900 leading-snug">
                    {selectedWork.title}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectWork(null);
                      onOpenMemberProfile(selectedWork.author_username);
                    }}
                    className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-[#1D4ED8] hover:underline"
                  >
                    {selectedWork.author_name} · Kelas {selectedWork.author_kelas}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectWork(null)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Admin Moderation Bar */}
              {currentUser?.role === 'admin' && (
                <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">Kontrol Pembina:</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleComments(selectedWork)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700"
                    >
                      {selectedWork.comments_disabled ? (
                        <>
                          <Unlock className="w-3.5 h-3.5 text-emerald-600" />
                          Aktifkan Komentar
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5 text-amber-600" />
                          Nonaktifkan Komentar
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteWork(selectedWork)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-rose-200 hover:bg-rose-50 rounded-lg text-rose-700"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Hapus Konten
                    </button>
                  </div>
                </div>
              )}

              {/* Description + Comments Scroll */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {selectedWork.description && (
                  <p className="text-sm text-slate-700 leading-relaxed">{selectedWork.description}</p>
                )}

                <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => handleLike(selectedWork)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium min-h-[38px] ${
                      selectedWork.liked_by_me ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${selectedWork.liked_by_me ? 'fill-current' : ''}`} />
                    <span className="font-mono tabular-nums">{selectedWork.likes_count}</span> Suka
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShare(selectedWork)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 min-h-[38px]"
                  >
                    <Share2 className="w-4 h-4" />
                    <span className="font-mono tabular-nums">{selectedWork.shares_count}</span> Bagikan
                  </button>
                </div>

                {/* Comment List */}
                <div className="space-y-3 pt-2">
                  {(() => {
                    const activeComments = cloudComments ?? selectedWork.comments ?? [];
                    return (
                      <>
                        <p className="text-xs font-semibold text-slate-700">
                          Diskusi &amp; Apresiasi ({activeComments.length})
                        </p>
                        {activeComments.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            Belum ada komentar. Jadilah yang pertama memberikan tanggapan edukatif.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {activeComments.map((c) => (
                              <div key={c.id} className="bg-slate-50 border border-slate-200/70 rounded-xl p-3 space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-semibold text-slate-900">
                                    {c.author_name}{' '}
                                    <span className="font-normal text-slate-500">
                                      · {c.author_role === 'admin' ? 'Pembina' : `Kelas ${c.author_kelas}`}
                                    </span>
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-slate-400">{formatTimeAgo(c.created_at)}</span>
                                    {currentUser?.role === 'admin' && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteComment(c)}
                                        title="Hapus komentar"
                                        className="text-slate-400 hover:text-rose-600 p-1"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <p className="text-sm text-slate-700 leading-snug">{c.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Comment Input Footer */}
              <div className="p-4 border-t border-slate-200 bg-white">
                {selectedWork.comments_disabled === 1 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
                    <Lock className="w-4 h-4 shrink-0" />
                    Kolom komentar dinonaktifkan sementara oleh Pembina NMC.
                  </p>
                ) : (
                  <form onSubmit={handleCommentSubmit} className="space-y-2">
                    {commentError && (
                      <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{commentError}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder={
                          currentUser
                            ? 'Tulis komentar positif & membangun...'
                            : 'Masuk terlebih dahulu untuk berkomentar'
                        }
                        onFocus={() => {
                          if (!currentUser) onRequireLogin();
                        }}
                        className="flex-1 px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#1D4ED8]"
                      />
                      <button
                        type="submit"
                        disabled={submittingComment || !commentText.trim()}
                        className="min-h-[42px] min-w-[42px] px-3.5 inline-flex items-center justify-center rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white disabled:opacity-50 transition-colors"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
