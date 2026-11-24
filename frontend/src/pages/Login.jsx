import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Login() {
  const [form, setForm]             = useState({ email: '', password: '' });
  const [googlePhone, setGooglePhone] = useState('');
  const [phoneError, setPhoneError]   = useState('');
  const [loading, setLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const phoneInputRef = useRef(null);
  const { login, loginWithGoogle, loginDemo, isFirebaseConfigured } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form.email, form.password);
      toast.success('Welcome back! 👋');
      navigate('/dashboard');
    } catch (err) {
      const msg = err.code === 'auth/invalid-credential'
        ? 'Invalid email or password'
        : err.message;
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    const cleaned = googlePhone.trim().replace(/\D/g, '');
    if (!cleaned) {
      setPhoneError('Phone number is mandatory before signing in with Google');
      toast.error('⚠️ Phone number is mandatory to sign in with Google! 📱', {
        duration: 4000,
      });
      if (phoneInputRef.current) phoneInputRef.current.focus();
      return;
    }

    if (cleaned.length !== 10) {
      setPhoneError('Please enter a valid 10-digit mobile number');
      toast.error('Please enter a valid 10-digit mobile number');
      if (phoneInputRef.current) phoneInputRef.current.focus();
      return;
    }

    setPhoneError('');
    setGoogleLoading(true);
    try {
      await loginWithGoogle(`+91 ${cleaned}`);
      toast.success('Welcome to MoneyMap! 🎉');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDemo = () => {
    loginDemo();
    toast.success('Logged in as Demo User! 🚀');
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-3xl font-bold text-white">M</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">MoneyMap</h1>
          <p className="text-gray-500 mt-1">Track every rupee, build every goal</p>
        </div>

        {/* Demo Mode Notice */}
        {!isFirebaseConfigured && (
          <div className="mb-4 p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-900 flex items-start gap-2.5">
            <span className="text-lg">💡</span>
            <div className="flex-1">
              <p className="font-semibold">Instant Demo Mode Active</p>
              <p className="text-blue-700 mt-0.5">
                Firebase keys are not set yet. You can click <strong>Instant Demo Explore</strong> below to try the full app right now with sample data!
              </p>
            </div>
          </div>
        )}

        <div className="card">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Sign in to your account</h2>

          {/* Instant 1-Click Demo Button */}
          <button
            type="button"
            onClick={handleDemo}
            className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl text-sm shadow hover:shadow-md transition-all flex items-center justify-center gap-2 mb-4"
          >
            <span>⚡</span> Instant 1-Click Demo Explore
          </button>

          {/* Google Sign In with Mandatory Phone Number */}
          <div className="bg-gradient-to-br from-blue-50/60 to-indigo-50/40 border border-blue-100 rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                <span>📱 Mobile Number</span>
                <span className="text-red-500 font-bold">*Mandatory</span>
              </label>
              <span className="text-[11px] text-blue-600 font-medium">Required for Google Login</span>
            </div>

            <div className="relative mb-2">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-600 font-semibold text-sm select-none">
                🇮🇳 +91
              </span>
              <input
                type="tel"
                ref={phoneInputRef}
                className={`input-field pl-16 text-sm bg-white ${
                  phoneError ? 'border-red-500 ring-2 ring-red-100 bg-red-50/30' : ''
                }`}
                placeholder="98765 43210"
                maxLength={10}
                value={googlePhone}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setGooglePhone(val);
                  if (phoneError) setPhoneError('');
                }}
              />
            </div>

            {phoneError && (
              <p className="text-xs text-red-600 mb-2 font-medium flex items-center gap-1 animate-pulse">
                ⚠️ {phoneError}
              </p>
            )}

            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 shadow-sm transition-all"
            >
              {googleLoading ? (
                <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></span>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              Sign in with Google
            </button>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-gray-100"></div>
            <span className="text-xs text-gray-400 font-medium">or email</span>
            <div className="flex-1 h-px bg-gray-100"></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <input type="email" className="input-field" placeholder="you@example.com"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input-field" placeholder="••••••••"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Signing in...</> : 'Sign In →'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            New to MoneyMap?{' '}
            <Link to="/register" className="text-blue-600 font-semibold hover:underline">Create free account</Link>
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-6">
          {[{ icon: '🔐', text: 'Firebase Auth' }, { icon: '☁️', text: 'Cloudinary' }, { icon: '⚡', text: 'Vercel Ready' }].map((f) => (
            <div key={f.text} className="text-center bg-white rounded-xl p-3 shadow-sm border border-gray-100">
              <div className="text-xl mb-1">{f.icon}</div>
              <div className="text-xs text-gray-600 font-medium">{f.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
