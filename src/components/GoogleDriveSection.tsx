import { useCallback, useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  AlertTriangle,
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  LogOut,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  createDriveFolder,
  deleteDriveFilePermanent,
  downloadDriveFile,
  DriveAuthExpiredError,
  getGoogleAccessToken,
  googleSignIn,
  googleSignOut,
  initGoogleAuth,
  listDriveFiles,
  renameDriveFile,
  trashDriveFile,
  uploadFileToDrive,
  type DriveFileItem,
} from '../lib/googleDrive';
import { formatDateID } from '../lib/mediaAssets';

interface GoogleDriveSectionProps {
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

type ConfirmAction =
  | { kind: 'create_folder'; folderName: string }
  | { kind: 'upload_file'; file: File }
  | { kind: 'rename_file'; file: DriveFileItem; nextName: string }
  | { kind: 'trash_file'; file: DriveFileItem }
  | { kind: 'delete_permanent'; file: DriveFileItem };

export function GoogleDriveSection({ onToast }: GoogleDriveSectionProps) {
  const [needsAuth, setNeedsAuth] = useState(() => !getGoogleAccessToken());
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | 'folder' | 'image' | 'video' | 'document'>('all');
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'Drive Saya' },
  ]);

  // Prompts & Explicit Confirmation Modal
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [renameTarget, setRenameTarget] = useState<DriveFileItem | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [executingConfirm, setExecutingConfirm] = useState(false);

  const currentFolder = breadcrumbs[breadcrumbs.length - 1];

  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (user) => {
        setGoogleUser(user);
        setNeedsAuth(false);
      },
      () => {
        setGoogleUser(null);
        setNeedsAuth(true);
      }
    );
    return unsubscribe;
  }, []);

  const loadFiles = useCallback(
    async (opts?: { append?: boolean; pageToken?: string }) => {
      if (!getGoogleAccessToken()) {
        setNeedsAuth(true);
        return;
      }
      setLoadingFiles(true);
      try {
        const res = await listDriveFiles({
          folderId: currentFolder.id,
          query,
          category,
          pageToken: opts?.pageToken,
        });
        setFiles((prev) => (opts?.append ? [...prev, ...res.files] : res.files));
        setNextPageToken(res.nextPageToken);
      } catch (err) {
        if (err instanceof DriveAuthExpiredError) {
          setNeedsAuth(true);
          onToast(err.message, 'info');
        } else {
          onToast(err instanceof Error ? err.message : 'Gagal memuat file Google Drive.', 'error');
        }
      } finally {
        setLoadingFiles(false);
      }
    },
    [currentFolder.id, query, category, onToast]
  );

  useEffect(() => {
    if (!needsAuth) {
      loadFiles();
    }
  }, [needsAuth, loadFiles]);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      setGoogleUser(res.user);
      setNeedsAuth(false);
      onToast(`Terhubung ke Google Drive (${res.user.email || res.user.displayName}).`, 'success');
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : 'Login Google Drive dibatalkan atau gagal.',
        'error'
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await googleSignOut();
    setGoogleUser(null);
    setFiles([]);
    setBreadcrumbs([{ id: 'root', name: 'Drive Saya' }]);
    setNeedsAuth(true);
    onToast('Koneksi Google Drive diputus.', 'info');
  };

  const handleExecuteConfirm = async () => {
    if (!confirmAction) return;
    setExecutingConfirm(true);
    try {
      if (confirmAction.kind === 'create_folder') {
        const created = await createDriveFolder(confirmAction.folderName, currentFolder.id);
        setFiles((prev) => [created, ...prev]);
        setShowFolderPrompt(false);
        setFolderNameInput('');
        onToast(`Folder "${created.name}" berhasil dibuat di Google Drive.`, 'success');
      } else if (confirmAction.kind === 'upload_file') {
        const uploaded = await uploadFileToDrive(confirmAction.file, currentFolder.id);
        setFiles((prev) => [uploaded, ...prev]);
        onToast(`File "${uploaded.name}" berhasil diunggah ke Google Drive.`, 'success');
      } else if (confirmAction.kind === 'rename_file') {
        const updated = await renameDriveFile(confirmAction.file.id, confirmAction.nextName);
        setFiles((prev) =>
          prev.map((f) => (f.id === confirmAction.file.id ? { ...f, name: updated.name } : f))
        );
        setRenameTarget(null);
        setRenameInput('');
        onToast(`Nama file diperbarui menjadi "${updated.name}".`, 'success');
      } else if (confirmAction.kind === 'trash_file') {
        await trashDriveFile(confirmAction.file.id);
        setFiles((prev) => prev.filter((f) => f.id !== confirmAction.file.id));
        onToast(`"${confirmAction.file.name}" dipindahkan ke Sampah Google Drive.`, 'info');
      } else if (confirmAction.kind === 'delete_permanent') {
        await deleteDriveFilePermanent(confirmAction.file.id);
        setFiles((prev) => prev.filter((f) => f.id !== confirmAction.file.id));
        onToast(`"${confirmAction.file.name}" dihapus permanen dari Google Drive.`, 'info');
      }
      setConfirmAction(null);
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        setNeedsAuth(true);
        setConfirmAction(null);
        onToast(err.message, 'info');
      } else {
        onToast(err instanceof Error ? err.message : 'Operasi Google Drive gagal.', 'error');
      }
    } finally {
      setExecutingConfirm(false);
    }
  };

  const formatSize = (sizeStr?: string) => {
    const n = Number(sizeStr);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (mime: string) => {
    if (mime === 'application/vnd.google-apps.folder') {
      return <Folder className="w-5 h-5 text-[#CA8A04]" />;
    }
    if (mime.startsWith('image/')) {
      return <ImageIcon className="w-5 h-5 text-[#1D4ED8]" />;
    }
    if (mime.startsWith('video/')) {
      return <Film className="w-5 h-5 text-[#B91C1C]" />;
    }
    if (mime === 'application/pdf' || mime.includes('document') || mime.includes('spreadsheet')) {
      return <FileText className="w-5 h-5 text-emerald-700" />;
    }
    return <FileIcon className="w-5 h-5 text-slate-500" />;
  };

  const getConfirmCopy = (action: ConfirmAction) => {
    switch (action.kind) {
      case 'create_folder':
        return {
          title: 'Konfirmasi Buat Folder Baru',
          description: `Buat folder baru bernama "${action.folderName}" di dalam "${currentFolder.name}" pada Google Drive Anda?`,
          confirmLabel: 'Ya, Buat Folder',
          danger: false,
        };
      case 'upload_file':
        return {
          title: 'Konfirmasi Upload ke Google Drive',
          description: `Unggah file "${action.file.name}" (${formatSize(String(action.file.size))}) ke folder "${currentFolder.name}" di Google Drive Anda?`,
          confirmLabel: 'Ya, Unggah File',
          danger: false,
        };
      case 'rename_file':
        return {
          title: 'Konfirmasi Ubah Nama File',
          description: `Ubah nama "${action.file.name}" menjadi "${action.nextName}" di Google Drive Anda?`,
          confirmLabel: 'Ya, Simpan Nama',
          danger: false,
        };
      case 'trash_file':
        return {
          title: 'Pindahkan ke Sampah Google Drive?',
          description: `Anda yakin ingin memindahkan "${action.file.name}" ke Sampah di Google Drive? Anda masih dapat memulihkannya dari Sampah Drive.`,
          confirmLabel: 'Pindahkan ke Sampah',
          danger: true,
        };
      case 'delete_permanent':
        return {
          title: 'Hapus Permanen dari Google Drive?',
          description: `Tindakan ini tidak dapat dibatalkan. File "${action.file.name}" akan dihapus permanen dari Google Drive Anda.`,
          confirmLabel: 'Hapus Permanen',
          danger: true,
        };
    }
  };

  if (needsAuth) {
    return (
      <section className="space-y-8">
        <div className="border-b border-slate-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#B91C1C]">
            Penyimpanan Cloud Terhubung · MMC SMPN 2 Ciamis
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-slate-900">
            Integrasi Google Drive
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Hubungkan akun Google Anda untuk menelusuri, mengunggah, mengunduh, dan mengelola arsip foto, video liputan, serta dokumen tugas Multimedia Media Center langsung melalui Google Drive.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 max-w-2xl mx-auto text-center space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 text-[#1D4ED8] flex items-center justify-center mx-auto">
            <HardDrive className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900">
              Masuk dengan Akun Google untuk Mengakses Drive
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Dengan izin Anda, aplikasi ini dapat melihat daftar file, membuat folder arsip, mengunggah dokumentasi kegiatan, serta mengunduh aset dari Google Drive Anda.
            </p>
          </div>

          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={isLoggingIn}
              onClick={handleGoogleLogin}
              className="inline-flex items-center gap-3 px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl shadow-sm font-medium text-sm transition-colors disabled:opacity-60 min-h-[44px]"
            >
              <svg
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
                className="w-5 h-5 block shrink-0"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
                <path fill="none" d="M0 0h48v48H0z" />
              </svg>
              <span>{isLoggingIn ? 'Menghubungkan...' : 'Sign in with Google'}</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#B91C1C]">
            Arsip Cloud · Google Drive
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-slate-900">
            Pengelola File Google Drive
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Kelola dokumen liputan, foto dokumentasi, dan materi ekstrakurikuler langsung di Google Drive Anda.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {googleUser && (
            <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-xl px-3.5 py-2">
              {googleUser.photoURL && (
                <img
                  src={googleUser.photoURL}
                  alt={googleUser.displayName || 'Akun Google'}
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-full object-cover"
                />
              )}
              <div className="text-left">
                <p className="text-xs font-semibold text-slate-900 leading-tight">
                  {googleUser.displayName || 'Pengguna Google'}
                </p>
                <p className="text-[11px] text-slate-500 leading-tight">{googleUser.email}</p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleLogout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl min-h-[40px]"
          >
            <LogOut className="w-4 h-4" />
            Putuskan Drive
          </button>
        </div>
      </div>

      {/* Toolbar: Search, Filters, Folder & Upload Actions */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama file atau folder di Drive..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-[#1D4ED8] focus:bg-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadFiles()}
              disabled={loadingFiles}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl min-h-[40px]"
            >
              <RefreshCw className={`w-4 h-4 ${loadingFiles ? 'animate-spin' : ''}`} />
              Muat Ulang
            </button>

            <button
              type="button"
              onClick={() => {
                setFolderNameInput('');
                setShowFolderPrompt(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-800 bg-amber-100 hover:bg-[#FACC15] rounded-xl min-h-[40px]"
            >
              <FolderPlus className="w-4 h-4" />
              Folder Baru
            </button>

            <label className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl cursor-pointer min-h-[40px]">
              <UploadCloud className="w-4 h-4" />
              Upload ke Drive
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) {
                    setConfirmAction({ kind: 'upload_file', file });
                  }
                }}
              />
            </label>
          </div>
        </div>

        {/* Category Filter Tabs + Breadcrumbs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1 text-xs font-medium text-slate-600 overflow-x-auto">
            {breadcrumbs.map((bc, idx) => (
              <div key={bc.id} className="inline-flex items-center gap-1 shrink-0">
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                <button
                  type="button"
                  onClick={() => setBreadcrumbs((prev) => prev.slice(0, idx + 1))}
                  className={`px-2 py-1 rounded-lg hover:bg-slate-100 ${
                    idx === breadcrumbs.length - 1 ? 'text-[#1D4ED8] font-semibold' : ''
                  }`}
                >
                  {bc.name}
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit overflow-x-auto max-w-full">
            {(
              [
                ['all', 'Semua'],
                ['folder', 'Folder'],
                ['image', 'Foto'],
                ['video', 'Video'],
                ['document', 'Dokumen'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  category === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Drive File List */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loadingFiles && files.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Memuat file dari Google Drive...
          </div>
        ) : files.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <HardDrive className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-medium text-slate-800">Folder ini kosong</p>
            <p className="text-xs text-slate-500">
              Belum ada file yang cocok dengan filter pencarian di lokasi Google Drive ini.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Nama File / Folder</th>
                  <th className="py-3 px-4">Ukuran</th>
                  <th className="py-3 px-4">Diubah</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {files.map((file) => {
                  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                  return (
                    <tr key={file.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        {isFolder ? (
                          <button
                            type="button"
                            onClick={() =>
                              setBreadcrumbs((prev) => [...prev, { id: file.id, name: file.name }])
                            }
                            className="inline-flex items-center gap-3 text-left font-medium text-slate-900 hover:text-[#1D4ED8]"
                          >
                            {getFileIcon(file.mimeType)}
                            <span>{file.name}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-3">
                            {file.thumbnailLink ? (
                              <img
                                src={file.thumbnailLink}
                                alt={file.name}
                                referrerPolicy="no-referrer"
                                className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                              />
                            ) : (
                              <span className="shrink-0">{getFileIcon(file.mimeType)}</span>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 truncate max-w-xs sm:max-w-md">
                                {file.name}
                              </p>
                              <p className="text-[11px] font-mono text-slate-400 truncate max-w-xs">
                                {file.mimeType}
                              </p>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {isFolder ? 'Folder' : formatSize(file.size)}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {file.modifiedTime ? formatDateID(file.modifiedTime) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Buka di Google Drive"
                              className="p-2 text-slate-500 hover:text-[#1D4ED8] hover:bg-blue-50 rounded-lg"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          {!isFolder && (
                            <button
                              type="button"
                              onClick={() =>
                                downloadDriveFile(file).catch((err) =>
                                  onToast(err instanceof Error ? err.message : 'Gagal mengunduh.', 'error')
                                )
                              }
                              title="Unduh file"
                              className="p-2 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setRenameTarget(file);
                              setRenameInput(file.name);
                            }}
                            title="Ganti nama"
                            className="p-2 text-slate-500 hover:text-[#1D4ED8] hover:bg-blue-50 rounded-lg"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ kind: 'trash_file', file })}
                            title="Pindahkan ke Sampah"
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {nextPageToken && (
          <div className="p-4 border-t border-slate-100 text-center">
            <button
              type="button"
              disabled={loadingFiles}
              onClick={() => loadFiles({ append: true, pageToken: nextPageToken })}
              className="px-4 py-2 text-xs font-semibold text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 rounded-xl"
            >
              {loadingFiles ? 'Memuat...' : 'Muat Lebih Banyak File'}
            </button>
          </div>
        )}
      </div>

      {/* Create Folder Prompt Modal */}
      {showFolderPrompt && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowFolderPrompt(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Buat Folder Google Drive</h2>
              <button
                type="button"
                onClick={() => setShowFolderPrompt(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={folderNameInput}
              onChange={(e) => setFolderNameInput(e.target.value)}
              placeholder="Contoh: Arsip Liputan MMC 2026"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowFolderPrompt(false)}
                className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!folderNameInput.trim()}
                onClick={() =>
                  setConfirmAction({ kind: 'create_folder', folderName: folderNameInput.trim() })
                }
                className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 rounded-xl"
              >
                Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename File Prompt Modal */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Ubah Nama di Google Drive</h2>
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!renameInput.trim() || renameInput.trim() === renameTarget.name}
                onClick={() =>
                  setConfirmAction({
                    kind: 'rename_file',
                    file: renameTarget,
                    nextName: renameInput.trim(),
                  })
                }
                className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 rounded-xl"
              >
                Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Confirmation Dialog for All Drive Mutations */}
      {confirmAction && (() => {
        const copy = getConfirmCopy(confirmAction);
        return (
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !executingConfirm && setConfirmAction(null)}
          >
            <div
              className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    copy.danger ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-[#1D4ED8]'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-900">{copy.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{copy.description}</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={executingConfirm}
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl min-h-[42px]"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={executingConfirm}
                  onClick={handleExecuteConfirm}
                  className={`px-4 py-2.5 text-xs sm:text-sm font-semibold text-white rounded-xl min-h-[42px] disabled:opacity-60 ${
                    copy.danger
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-[#1D4ED8] hover:bg-[#1E40AF]'
                  }`}
                >
                  {executingConfirm ? 'Memproses...' : copy.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
