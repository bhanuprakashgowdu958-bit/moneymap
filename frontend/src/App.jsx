import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import AppUpdatePrompt from './components/AppUpdatePrompt';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import AddExpense from './pages/AddExpense';
import Expenses from './pages/Expenses';
import Budgets from './pages/Budgets';
import Insights from './pages/Insights';
import Settings from './pages/Settings';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-center"
          containerStyle={{ top: 'max(14px, env(safe-area-inset-top))' }}
          toastOptions={{
            style: {
              borderRadius: '14px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              fontWeight: '500',
              maxWidth: '92vw',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
            },
            success: { style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } },
            error: { style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } }
          }}
        />
        <AppUpdatePrompt />
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected */}
          <Route path="/dashboard" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/add-expense" element={<ProtectedRoute><Layout><AddExpense /></Layout></ProtectedRoute>} />
          <Route path="/expenses" element={<ProtectedRoute><Layout><Expenses /></Layout></ProtectedRoute>} />
          <Route path="/budgets" element={<ProtectedRoute><Layout><Budgets /></Layout></ProtectedRoute>} />
          <Route path="/insights" element={<ProtectedRoute><Layout><Insights /></Layout></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Layout><Settings /></Layout></ProtectedRoute>} />

          {/* Redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
