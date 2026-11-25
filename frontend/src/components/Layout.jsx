import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getOrCreateWebhookToken, isDemoUser } from '../lib/firestore';
import { isNativeAndroid, syncNativeConfig } from '../lib/nativeBridge';

const navItems = [
  { to: '/dashboard', icon: '📊', label: 'Home' },
  { to: '/expenses', icon: '📋', label: 'Expenses' },
  { to: '/add-expense', icon: '➕', label: 'Add', highlight: true },
  { to: '/budgets', icon: '🎯', label: 'Budgets' },
  { to: '/insights', icon: '💡', label: 'Insights' },
];

export default function Layout({ children }) {
  const { user, displayName, photoURL, isFirebaseConfigured, logout } = useAuth();
  const navigate = useNavigate();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const maxHeightRef = useRef(typeof window !== 'undefined' ? window.innerHeight : 0);
  const lastWidthRef = useRef(typeof window !== 'undefined' ? window.innerWidth : 0);

  useEffect(() => {
    const updateKeyboardState = () => {
      if (window.innerWidth >= 1024) {
        setKeyboardOpen(false);
        return;
      }
      if (Math.abs(window.innerWidth - lastWidthRef.current) > 40) {
        lastWidthRef.current = window.innerWidth;
        maxHeightRef.current = window.innerHeight;
      } else if (window.innerHeight > maxHeightRef.current) {
        maxHeightRef.current = window.innerHeight;
      }
      const heightDrop = maxHeightRef.current - window.innerHeight;
      setKeyboardOpen(heightDrop > 140);
    };

    window.addEventListener('resize', updateKeyboardState);
    window.visualViewport?.addEventListener('resize', updateKeyboardState);
    return () => {
      window.removeEventListener('resize', updateKeyboardState);
      window.visualViewport?.removeEventListener('resize', updateKeyboardState);
    };
  }, []);

  const handleFocusIn = (e) => {
    const el = e.target;
    if (!el || window.innerWidth >= 1024) return;
    const tag = el.tagName;
    const inputType = (el.type || '').toLowerCase();
    const opensKeyboard =
      tag === 'TEXTAREA' ||
      (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'file', 'button', 'submit'].includes(inputType));
    if (!opensKeyboard) return;

    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 280);
  };

  useEffect(() => {
    if (isNativeAndroid() && user?.uid && !isDemoUser(user.uid)) {
      getOrCreateWebhookToken(user.uid)
        .then((tok) => { if (tok) syncNativeConfig(tok); })
        .catch(() => {});
    }
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-[100dvh] bg-gray-50 flex overflow-hidden">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-gray-100 fixed inset-y-0 left-0 z-10 shadow-sm overflow-y-auto">
        {/* Logo */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-md">
              <span className="text-white text-lg font-bold">M</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">MoneyMap</h1>
              <p className="text-xs text-gray-400">Track Every Penny</p>
            </div>
          </div>
        </div>

        {/* Demo Mode Badge */}
        {!isFirebaseConfigured && (
          <div className="mx-4 mt-3 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2">
            <span className="text-xs">⚡</span>
            <span className="text-[11px] font-semibold text-amber-800">Demo Mode (Local Data)</span>
          </div>
        )}

        {/* User Card */}
        <div className="p-4 mx-4 mt-3 bg-blue-50/70 border border-blue-100/60 rounded-xl flex items-center gap-3">
          {photoURL ? (
            <img
              src={photoURL}
              alt={displayName}
              className="w-10 h-10 rounded-xl object-cover border border-blue-200"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
              {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-gray-500 font-medium">Signed in as</p>
            <p className="font-semibold text-gray-800 text-sm truncate">{displayName}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1 mt-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
              {item.highlight && (
                <span className="ml-auto bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-semibold">New</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Settings & Logout */}
        <div className="p-4 border-t border-gray-100 space-y-1">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50'
              }`
            }
          >
            <span>⚙️</span> Settings
          </NavLink>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-all"
          >
            <span>🚪</span> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 lg:ml-64 flex flex-col overflow-hidden">
        {/* Top bar - mobile */}
        <header className="lg:hidden bg-white/95 backdrop-blur-md border-b border-gray-100 px-4 pb-2.5 pt-safe min-h-[56px] flex items-center justify-between sticky top-0 z-30 shadow-sm">
          <NavLink to="/dashboard" className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-white text-sm font-bold">M</span>
            </div>
            <div className="min-w-0">
              <span className="font-bold text-gray-900 text-base leading-none block">MoneyMap</span>
              {!isFirebaseConfigured && (
                <span className="text-[10px] font-semibold text-amber-700 leading-none">Demo Mode</span>
              )}
            </div>
          </NavLink>

          <NavLink
            to="/settings"
            aria-label="Open settings and profile"
            className={({ isActive }) =>
              `flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border transition-all active:scale-95 ${
                isActive
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-gray-50/90 border-gray-200/80 text-gray-700 hover:bg-gray-100'
              }`
            }
          >
            {photoURL ? (
              <img src={photoURL} alt={displayName} className="w-7 h-7 rounded-full object-cover border border-blue-200 flex-shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <span className="text-xs font-semibold truncate max-w-[84px]">{displayName?.split(' ')[0] || 'Profile'}</span>
            <SettingsIcon className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
          </NavLink>
        </header>

        {/* Page content */}
        <div
          onFocusCapture={handleFocusIn}
          className={`flex-1 overflow-y-auto px-3.5 py-4 sm:p-6 lg:p-8 ${keyboardOpen ? 'pb-6' : 'pb-28'} lg:pb-8 page-enter max-w-7xl mx-auto w-full`}
        >
          {children}
        </div>
      </main>

      {/* Bottom nav - Mobile (hidden while virtual keyboard is open so form inputs stay unobstructed) */}
      {!keyboardOpen && (
        <nav
          aria-label="Primary mobile navigation"
          className="lg:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-gray-200/80 px-1.5 pt-1.5 pb-safe z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
        >
        <div className="grid grid-cols-5 items-end max-w-md mx-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                item.highlight
                  ? 'flex flex-col items-center justify-center -mt-4 pb-1 group'
                  : `flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl transition-all active:scale-95 ${
                      isActive ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                    }`
              }
            >
              {({ isActive }) =>
                item.highlight ? (
                  <>
                    <span className="w-12 h-12 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30 flex items-center justify-center group-active:scale-95 transition-transform ring-4 ring-white">
                      <Plus className="w-6 h-6 text-white stroke-[2.75]" />
                    </span>
                    <span className={`text-[10px] font-semibold mt-0.5 ${isActive ? 'text-blue-600' : 'text-gray-600'}`}>
                      {item.label}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={`text-lg leading-none px-3 py-1 rounded-full transition-colors ${isActive ? 'bg-blue-50' : ''}`}>
                      {item.icon}
                    </span>
                    <span className={`text-[11px] leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
                      {item.label}
                    </span>
                  </>
                )
              }
            </NavLink>
          ))}
        </div>
      </nav>
      )}
    </div>
  );
}
