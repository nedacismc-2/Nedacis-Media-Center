import { useState, type FormEvent } from 'react';
import { Cloud, Lock, User, X } from 'lucide-react';
import type { StudentProfile } from '../types';
import { apiFetch, setStoredToken } from '../lib/api';
import { useFirebase } from '../context/FirebaseContext';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onLoginSuccess: (user: StudentProfile, token: string) => void;
  onGoogleLoginSuccess?: (email: string | null) => void;
}

export function LoginModal({ open, onClose, onLoginSuccess, onGoogleLoginSuccess }: LoginModalProps) {
  const { signInWithGoogle, firebaseUser, isFirebaseAdmin } = useFirebase();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  if (!open) return null;

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      const fbUser = await signInWithGoogle();
      onGoogleLoginSuccess?.(fbUser.email);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal masuk dengan akun Google.';
      if (!msg.includes('popup-closed-by-user')) {
        setError(msg);
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const submitLogin = async (u: string, p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string; user: StudentProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p }),
      });
      setStoredToken(res.token);
      onLoginSuccess(res.user, res.token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitLogin(username, password);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Masuk Akun MMC</h2>
            <p className="text-xs text-slate-500">SMPN 2 Ciamis · Cloud Firebase &amp; Akun Anggota</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">
              {error}
            </div>
          )}

          {/* Firebase Google Sign-In Section */}
          <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3">
            <div className="flex items-start gap-2.5">
              <Cloud className="w-4 h-4 text-[#1D4ED8] shrink-0 mt-0.5" />
              <div className="text-xs text-slate-700 leading-relaxed">
                <p className="font-semibold text-slate-900">
                  Masuk dengan Google (Sinkronisasi Lintas Perangkat)
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  Akun <span className="font-mono font-medium">NedacisMC@gmail.com</span> otomatis mendapatkan akses Admin penuh dan menyimpan seluruh perubahan ke Cloud Firestore.
                </p>
              </div>
            </div>

            {firebaseUser ? (
              <div className="p-2.5 bg-white border border-emerald-200 rounded-lg text-xs text-emerald-800 font-medium">
                Terhubung: {firebaseUser.email} {isFirebaseAdmin ? '(Admin Cloud)' : '(Anggota Cloud)'}
              </div>
            ) : (
              <button
                type="button"
                disabled={googleLoading}
                onClick={handleGoogleLogin}
                className="w-full py-2.5 px-4 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl min-h-[44px] flex items-center justify-center gap-2.5 shadow-sm transition-colors disabled:opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                {googleLoading ? 'Menghubungkan Google...' : 'Masuk dengan Google'}
              </button>
            )}
          </div>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink mx-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              Atau Akun Portal
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Username</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="mis. ahmad.fauzan atau admin"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-xl min-h-[46px] transition-colors"
            >
              {loading ? 'Memverifikasi...' : 'Masuk ke Portal'}
            </button>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <p className="text-[11px] font-medium text-slate-500">Akses Cepat Uji Coba:</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => submitLogin('ahmad.fauzan', 'siswa123')}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl text-left"
                >
                  <span className="block font-semibold text-slate-900">Akun Siswa</span>
                  <span className="font-mono text-[10px] text-slate-500">ahmad.fauzan / siswa123</span>
                </button>
                <button
                  type="button"
                  onClick={() => submitLogin('admin', 'adminmmc')}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl text-left"
                >
                  <span className="block font-semibold text-slate-900">Admin Utama</span>
                  <span className="font-mono text-[10px] text-slate-500">admin / adminmmc</span>
                </button>
                <button
                  type="button"
                  onClick={() => submitLogin('pembina1', 'pembina123')}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-blue-50/70 hover:bg-blue-100 border border-blue-200/70 rounded-xl text-left"
                >
                  <span className="block font-semibold text-[#1D4ED8]">Akun Pembina 1</span>
                  <span className="font-mono text-[10px] text-slate-500">pembina1 / pembina123</span>
                </button>
                <button
                  type="button"
                  onClick={() => submitLogin('pembina2', 'pembina123')}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-blue-50/70 hover:bg-blue-100 border border-blue-200/70 rounded-xl text-left"
                >
                  <span className="block font-semibold text-[#1D4ED8]">Akun Pembina 2</span>
                  <span className="font-mono text-[10px] text-slate-500">pembina2 / pembina123</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
