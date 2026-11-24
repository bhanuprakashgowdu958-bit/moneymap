import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { uploadToCloudinary } from '../lib/cloudinary';
import toast from 'react-hot-toast';

export default function Settings() {
  const { user, profile, displayName, monthlyIncome, currency, photoURL, phoneNumber, updateUserProfile, logout } = useAuth();
  const [form, setForm] = useState({
    name: displayName || '',
    monthlyIncome: monthlyIncome || '',
    currency: currency || '₹',
    phoneNumber: phoneNumber || profile?.phoneNumber || '',
  });
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('gemini_api_key')) || '';
  });
  const fileInputRef = useRef(null);

  const handleSaveGeminiKey = () => {
    if (geminiKey.trim()) {
      localStorage.setItem('gemini_api_key', geminiKey.trim());
      toast.success('Gemini AI Vision activated for receipt scanning! ✨');
    } else {
      localStorage.removeItem('gemini_api_key');
      toast.success('Gemini key cleared. Using local OCR scanner.');
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB');
      return;
    }

    setUploadingAvatar(true);
    toast.loading('Uploading profile picture to Cloudinary...', { id: 'avatar' });
    try {
      const result = await uploadToCloudinary(file, 'moneymap/avatars');
      await updateUserProfile({ photoURL: result.url });
      toast.success('Profile picture updated! 🖼️', { id: 'avatar' });
    } catch (err) {
      toast.error(err.message || 'Avatar upload failed', { id: 'avatar' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateUserProfile({
        name: form.name.trim(),
        monthlyIncome: Number(form.monthlyIncome) || 0,
        currency: form.currency,
        phoneNumber: form.phoneNumber.trim(),
      });
      toast.success('Profile updated successfully! ✅');
    } catch (err) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your profile, currency, and preferences</p>
      </div>

      {/* Avatar & Cloudinary Integration */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Profile Photo</h2>
        <div className="flex items-center gap-5">
          <div className="relative">
            {photoURL ? (
              <img
                src={photoURL}
                alt={displayName}
                className="w-20 h-20 rounded-2xl object-cover border-2 border-blue-100 shadow-sm"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-2xl font-bold shadow-sm">
                {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            {uploadingAvatar && (
              <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center">
                <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              </div>
            )}
          </div>

          <div className="flex-1">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <button
              type="button"
              disabled={uploadingAvatar}
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary text-sm py-2 px-4 inline-flex items-center gap-2"
            >
              <span>📷</span> Upload to Cloudinary
            </button>
            <p className="text-xs text-gray-400 mt-1.5">
              JPG, PNG, WebP up to 5MB. Hosted securely on Cloudinary CDN.
            </p>
          </div>
        </div>
      </div>

      {/* Profile Details */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Profile Settings</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input
              type="text"
              className="input-field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Email (Account)</label>
            <input
              type="email"
              className="input-field bg-gray-100 text-gray-500 cursor-not-allowed"
              value={user?.email || ''}
              readOnly
            />
          </div>
          <div>
            <label className="label">Mobile Phone Number</label>
            <input
              type="tel"
              className="input-field"
              placeholder="+91 98765 43210"
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Preferred Currency</label>
              <select
                className="input-field"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                <option value="₹">₹ - Indian Rupee (INR)</option>
                <option value="$">$ - US Dollar (USD)</option>
                <option value="€">€ - Euro (EUR)</option>
                <option value="£">£ - British Pound (GBP)</option>
                <option value="AED">AED - UAE Dirham</option>
              </select>
            </div>
            <div>
              <label className="label">Monthly Income ({form.currency})</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">{form.currency}</span>
                <input
                  type="number"
                  className="input-field pl-8"
                  placeholder="50000"
                  value={form.monthlyIncome}
                  onChange={(e) => setForm({ ...form, monthlyIncome: e.target.value })}
                  min="0"
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-400">
            Monthly income powers your "Safe to Spend" meter on the dashboard.
          </p>

          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Saving...</>
            ) : (
              'Save Profile Changes ✅'
            )}
          </button>
        </form>
      </div>

      {/* AI Receipt & Vision Scanner Settings */}
      <div className="card border border-primary/20 bg-gradient-to-br from-white to-primary/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <h2 className="text-base font-semibold text-gray-900">AI Receipt Scanner (Google Gemini Vision)</h2>
          </div>
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${geminiKey ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-gray-100 text-gray-600'}`}>
            {geminiKey ? 'AI Vision Active ✨' : 'Using Local OCR'}
          </span>
        </div>
        <p className="text-xs text-gray-600 mb-4 leading-relaxed">
          By default, MoneyMap uses its built-in offline OCR engine. For 100% human-level accuracy across tricky mobile screenshots (Paytm/PhonePe cashbacks, masked UPI IDs, handwritten bills), you can add a free Google Gemini 2.0 Flash API key.
        </p>

        <div className="space-y-3">
          <div>
            <label className="label text-xs">Google Gemini API Key (Optional)</label>
            <div className="flex gap-2">
              <input
                type="password"
                className="input-field text-sm font-mono"
                placeholder="AIzaSy..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
              />
              <button
                type="button"
                onClick={handleSaveGeminiKey}
                className="btn-primary text-sm whitespace-nowrap"
              >
                Save Key
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
            <span>Get a free key in 30 seconds at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-semibold">Google AI Studio →</a></span>
            {geminiKey && (
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('gemini_api_key');
                  setGeminiKey('');
                  toast.success('Gemini key removed. Using local OCR scanner.');
                }}
                className="text-red-500 hover:underline"
              >
                Remove Key
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cloud Stack Info */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Infrastructure & Cloud Services</h2>
        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl">
            <span className="text-xl">🔥</span>
            <div>
              <p className="font-semibold text-gray-800">Firebase Authentication & Cloud Firestore</p>
              <p className="text-xs text-gray-500">Live multi-device sync with enterprise-grade security</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl">
            <span className="text-xl">☁️</span>
            <div>
              <p className="font-semibold text-gray-800">Cloudinary Media CDN</p>
              <p className="text-xs text-gray-500">Fast optimization and edge delivery for receipts and avatars</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-xl">
            <span className="text-xl">▲</span>
            <div>
              <p className="font-semibold text-gray-800">Vercel Edge Network</p>
              <p className="text-xs text-gray-500">Global hosting with instant SSL and zero cold-starts</p>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card border border-red-100">
        <h2 className="text-base font-semibold text-red-600 mb-2">Account Session</h2>
        <p className="text-xs text-gray-500 mb-4">Sign out of MoneyMap on this device.</p>
        <button
          onClick={() => { if (window.confirm('Are you sure you want to log out?')) logout(); }}
          className="btn-danger flex items-center gap-2"
        >
          🚪 Sign Out from MoneyMap
        </button>
      </div>
    </div>
  );
}
