import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-[100dvh] pt-safe pb-safe flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg animate-pulse">
          <span className="text-2xl font-bold text-white">M</span>
        </div>
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-gray-400 text-sm font-medium">Loading MoneyMap...</p>
      </div>
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}
