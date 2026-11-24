import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/dashboard', icon: '📊', label: 'Dashboard' },
  { to: '/expenses', icon: '📋', label: 'Expenses' },
  { to: '/add-expense', icon: '➕', label: 'Add', highlight: true },
  { to: '/budgets', icon: '🎯', label: 'Budgets' },
  { to: '/insights', icon: '💡', label: 'Insights' },
];

export default function Layout({ children }) {
  const { user, displayName, photoURL, isFirebaseConfigured, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-gray-100 fixed inset-y-0 left-0 z-10 shadow-sm">
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
      <main className="flex-1 lg:ml-64">
        {/* Top bar - mobile */}
        <header className="lg:hidden bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-sm font-bold">M</span>
            </div>
            <span className="font-bold text-gray-900">MoneyMap</span>
          </div>

          <div className="flex items-center gap-2">
            {photoURL ? (
              <img src={photoURL} alt={displayName} className="w-7 h-7 rounded-lg object-cover border border-blue-200" />
            ) : (
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <span className="text-xs font-semibold text-gray-700 truncate max-w-[100px]">{displayName}</span>
          </div>
        </header>

        {/* Page content */}
        <div className="p-4 lg:p-8 pb-24 lg:pb-8 page-enter">
          {children}
        </div>
      </main>

      {/* Bottom nav - Mobile */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 px-2 py-2 z-10 shadow-lg">
        <div className="flex items-center justify-around">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all ${
                  item.highlight
                    ? 'bg-blue-600 text-white shadow-lg -mt-5 px-4 py-3'
                    : isActive
                    ? 'text-blue-600'
                    : 'text-gray-400'
                }`
              }
            >
              <span className={item.highlight ? 'text-xl' : 'text-lg'}>{item.icon}</span>
              <span className="text-xs font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
