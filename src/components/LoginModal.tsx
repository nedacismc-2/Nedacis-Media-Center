import { useState, type FormEvent } from 'react';
import { Lock, User, X } from 'lucide-react';
import type { StudentProfile } from '../types';
import { apiFetch, setStoredToken } from '../lib/api';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onLoginSuccess: (user: StudentProfile, token: string) => void;
}

export function LoginModal({ open, onClose, onLoginSuccess }: LoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

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
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Masuk Akun MMC</h2>
            <p className="text-xs text-slate-500">SMPN 2 Ciamis · Siswa Terdaftar &amp; Pembina</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">
              {error}
            </div>
          )}

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
  );
}
