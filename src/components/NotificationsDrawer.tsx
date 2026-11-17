import { Bell, BookOpen, Calendar, CheckCheck, CreditCard, Heart, MessageSquare, Share2, ShieldAlert, X } from 'lucide-react';
import type { NotificationItem } from '../types';
import { formatTimeAgo } from '../lib/mediaAssets';

interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
  onNavigateTarget: (target: string | null) => void;
}

export function NotificationsDrawer({
  open,
  onClose,
  notifications,
  onMarkAllRead,
  onNavigateTarget,
}: NotificationsDrawerProps) {
  if (!open) return null;

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'attendance':
        return <CreditCard className="w-4 h-4 text-emerald-600" />;
      case 'schedule':
        return <Calendar className="w-4 h-4 text-[#1D4ED8]" />;
      case 'like':
        return <Heart className="w-4 h-4 text-rose-600" />;
      case 'comment':
        return <MessageSquare className="w-4 h-4 text-indigo-600" />;
      case 'share':
        return <Share2 className="w-4 h-4 text-teal-600" />;
      case 'moderation':
        return <ShieldAlert className="w-4 h-4 text-amber-600" />;
      case 'task':
        return <BookOpen className="w-4 h-4 text-[#1D4ED8]" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md h-full flex flex-col border-l border-slate-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Notifikasi Real-Time</h2>
            <p className="text-xs text-slate-500">Interaksi karya, absensi NFC/QR &amp; pengingat jadwal</p>
          </div>
          <div className="flex items-center gap-1">
            {notifications.some((n) => n.is_read === 0) && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#1D4ED8] hover:bg-blue-50 rounded-lg"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Tandai dibaca
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Belum ada notifikasi baru.
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  onNavigateTarget(n.link_target);
                  onClose();
                }}
                className={`w-full text-left p-4 flex gap-3.5 hover:bg-slate-50 transition-colors ${
                  n.is_read === 0 ? 'bg-amber-50/60' : ''
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                  {getIcon(n.type)}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 truncate">{n.title}</p>
                    <span className="text-[11px] text-slate-400 shrink-0">{formatTimeAgo(n.created_at)}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
