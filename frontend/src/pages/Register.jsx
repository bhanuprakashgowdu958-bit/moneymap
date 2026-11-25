import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Register() {
  const [googlePhone, setGooglePhone] = useState('');
  const [phoneError, setPhoneError]   = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const phoneInputRef = useRef(null);
  const { signUpWithGoogleRegister } = useAuth();
  const navigate = useNavigate();

  const handleGoogle = async () => {
    const cleaned = googlePhone.trim().replace(/\D/g, '');
    if (!cleaned) {
      setPhoneError('Phone number is mandatory to create your account');
      toast.error('⚠️ Phone number is mandatory to sign up with Google! 📱', {
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
      const res = await signUpWithGoogleRegister(`+91 ${cleaned}`);
      if (res?.isNew) {
        toast.success('Account created! Welcome to MoneyMap 🎉');
      } else {
        toast.success(`Account found! Welcome back, ${res?.user?.displayName || 'friend'}! 🎉`);
      }
      navigate('/dashboard');
    } catch (err) {
      if (err.code === 'auth/unauthorized-domain') {
        toast.error('⚠️ Domain not authorized in Firebase! Please add moneymap-pl9w.vercel.app in Firebase Console -> Authentication -> Settings -> Authorized domains.', {
          duration: 8000,
        });
      } else if (err.code === 'auth/popup-closed-by-user') {
        toast('Google sign-up popup closed', { icon: 'ℹ️' });
      } else {
        toast.error(err.message || 'Google sign-up failed');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-5 sm:mb-8">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 shadow-lg">
            <span className="text-2xl sm:text-3xl font-bold text-white">M</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">MoneyMap</h1>
          <p className="text-gray-500 text-sm sm:text-base mt-1">Start tracking every rupee today</p>
        </div>

        <div className="card">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Create your free account</h2>

          {/* Google Sign In with Mandatory Phone Number */}
          <div className="bg-gradient-to-br from-blue-50/60 to-indigo-50/40 border border-blue-100 rounded-2xl p-4">
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
                inputMode="numeric"
                autoComplete="tel-national"
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
              className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 shadow-sm transition-all"
            >
              {googleLoading ? (
                <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></span>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              Sign up with Google
            </button>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 font-semibold hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
