import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { uploadToCloudinary } from '../lib/cloudinary';
import { getOrCreateWebhookToken, regenerateWebhookToken, isDemoUser } from '../lib/firestore';
import { downloadMacroDroidGuidePdf, downloadIosGuidePdf } from '../lib/macrodroidPdf';
import { CATEGORIES } from '../lib/constants';
import {
  isNativeAndroid,
  getNativeStatus,
  syncNativeConfig,
  setNativeAutoTrack,
  setNativeAppGuard,
  openNotificationAccessSettings,
  openUsageAccessSettings,
  openAppInfoSettings,
  requestNativeNotifications,
} from '../lib/nativeBridge';
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
  const [webhookToken, setWebhookToken] = useState('');
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testingGuard, setTestingGuard] = useState(false);
  const [guardCategory, setGuardCategory] = useState('food-delivery');
  const [guardTab, setGuardTab] = useState('ios');
  const [guideTab, setGuideTab] = useState('ios');
  const [showAdvancedAutomation, setShowAdvancedAutomation] = useState(false);
  const [nativeStatus, setNativeStatus] = useState(null);
  const fileInputRef = useRef(null);
  const onAndroidApp = isNativeAndroid();

  const refreshNativeStatus = useCallback(() => {
    if (!onAndroidApp) return;
    getNativeStatus().then(setNativeStatus).catch(() => {});
  }, [onAndroidApp]);

  useEffect(() => {
    if (user?.uid && !isDemoUser(user.uid)) {
      getOrCreateWebhookToken(user.uid)
        .then((tok) => {
          if (tok) {
            setWebhookToken(tok);
            if (onAndroidApp) syncNativeConfig(tok);
          }
        })
        .catch(() => {});
    }
  }, [user, onAndroidApp]);

  useEffect(() => {
    if (!onAndroidApp) return;
    refreshNativeStatus();
    const onResume = () => refreshNativeStatus();
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [onAndroidApp, refreshNativeStatus]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = webhookToken
    ? `${origin}/api/webhook?token=${webhookToken}`
    : '';
  const guardTextUrl = webhookToken
    ? `${origin}/api/budget-check?token=${webhookToken}&category=${guardCategory}&format=text`
    : '';
  const guardJsonUrl = webhookToken
    ? `${origin}/api/budget-check?token=${webhookToken}&category=${guardCategory}`
    : '';

  const handleCopyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Personal Webhook URL copied! 📋');
  };

  const handleCopyGuardUrl = () => {
    if (!guardTextUrl) return;
    navigator.clipboard.writeText(guardTextUrl);
    toast.success('App-Open Guard URL copied! 🛡️');
  };

  const handleTestGuard = async () => {
    if (!guardJsonUrl) return;
    setTestingGuard(true);
    try {
      const res = await fetch(guardJsonUrl);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Budget check works once deployed to Vercel.');
        return;
      }
      if (!data.hasBudget) {
        toast(`No monthly budget set for ${data.label} yet. Set one on the Budgets page!`, { icon: '🎯' });
      } else if (data.shouldAlert) {
        toast(data.message, { icon: data.overLimit ? '🚨' : '⚠️', duration: 6000 });
      } else {
        toast.success(data.message);
      }
    } catch {
      toast.error('Budget check endpoint requires Vercel deployment (or vercel dev).');
    } finally {
      setTestingGuard(false);
    }
  };

  const handleRegenerateWebhook = async () => {
    if (!user?.uid || isDemoUser(user.uid)) return;
    if (!window.confirm('Regenerate webhook URL? Your old phone shortcut URL will stop working.')) return;
    setLoadingWebhook(true);
    try {
      const next = await regenerateWebhookToken(user.uid, webhookToken);
      setWebhookToken(next);
      toast.success('New Webhook URL generated! 🔄');
    } catch {
      toast.error('Failed to regenerate token');
    } finally {
      setLoadingWebhook(false);
    }
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl) return;
    setTestingWebhook(true);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'INR 199.00 debited from A/C XX4921 to Swiggy via UPI Ref 433190821890',
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        toast.success(`Test logged: ${data.expense?.title} (${currency}${data.expense?.amount}) 🎉`);
        if (data.budgetAlert) {
          toast(data.budgetAlert, { icon: data.budget?.overLimit ? '🚨' : '⚠️', duration: 6000 });
        }
      } else {
        toast.error(data?.error || 'Webhook test works once deployed to Vercel.');
      }
    } catch {
      toast.error('Webhook endpoint requires Vercel deployment (or vercel dev).');
    } finally {
      setTestingWebhook(false);
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
    <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-0.5">Manage your profile, currency, and preferences</p>
      </div>

      {/* Avatar & Cloudinary Integration */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Profile Photo</h2>
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative flex-shrink-0">
            {photoURL ? (
              <img
                src={photoURL}
                alt={displayName}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-blue-100 shadow-sm"
              />
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-2xl font-bold shadow-sm">
                {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            {uploadingAvatar && (
              <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center">
                <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
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
              className="btn-secondary w-full sm:w-auto text-sm py-2 px-4 inline-flex items-center justify-center gap-2"
            >
              <span>📷</span> Upload Photo
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
            className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2"
          >
            {saving ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Saving...</>
            ) : (
              'Save Profile Changes ✅'
            )}
          </button>
        </form>
      </div>

      {/* Native Android 1-Tap Auto-Track & Guard (inside Android APK) */}
      {onAndroidApp ? (
        <div id="app-guard" className="card border border-emerald-500/25 bg-gradient-to-br from-white to-emerald-500/5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl flex-shrink-0">⚡</span>
              <h2 className="text-base font-semibold text-gray-900 truncate">Auto-Track & Food Guard</h2>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800 border border-emerald-300 flex-shrink-0">
              1-Tap Native
            </span>
          </div>

          {isDemoUser(user?.uid) ? (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              Sign in with your MoneyMap account to sync auto-tracked payments to your profile.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Toggle 1: Notification Auto-Track */}
              <div className="p-3.5 bg-white rounded-xl border border-gray-200 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Auto-Track UPI & Bank Alerts</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Logs GPay, PhonePe, Paytm & Bank debit notifications automatically
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await requestNativeNotifications();
                      const next = !nativeStatus?.autoTrackEnabled;
                      await setNativeAutoTrack(next);
                      await syncNativeConfig(webhookToken);
                      refreshNativeStatus();
                      if (next && !nativeStatus?.hasNotificationAccess) {
                        openNotificationAccessSettings();
                      } else {
                        toast.success(next ? 'Auto-Tracking enabled! ⚡' : 'Auto-Tracking paused');
                      }
                    }}
                    className={`w-12 h-7 rounded-full transition-colors flex-shrink-0 p-0.5 ${
                      nativeStatus?.autoTrackEnabled && nativeStatus?.hasNotificationAccess
                        ? 'bg-emerald-600'
                        : 'bg-gray-300'
                    }`}
                    aria-label="Toggle auto tracking"
                  >
                    <span
                      className={`block w-6 h-6 bg-white rounded-full shadow transition-transform ${
                        nativeStatus?.autoTrackEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {!nativeStatus?.hasNotificationAccess ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-2">
                    <p className="text-xs text-amber-900 font-medium">
                      1 step left: Allow MoneyMap under Android <strong>Notification Access</strong>.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={openNotificationAccessSettings}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                      >
                        Open Notification Access →
                      </button>
                      {nativeStatus?.sdkInt >= 33 && (
                        <button
                          type="button"
                          onClick={openAppInfoSettings}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900"
                        >
                          Greyed out? App Info (⋮ → Allow restricted)
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 font-semibold">✅ Notification Access Active</p>
                )}
              </div>

              {/* Toggle 2: Food App Budget Guard */}
              <div className="p-3.5 bg-white rounded-xl border border-gray-200 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Swiggy / Zomato Budget Guard</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Warns you the moment you open food or delivery apps over budget
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await requestNativeNotifications();
                      const next = !nativeStatus?.appGuardEnabled;
                      if (next && !nativeStatus?.hasUsageAccess) {
                        await setNativeAppGuard(true);
                        openUsageAccessSettings();
                        return;
                      }
                      await syncNativeConfig(webhookToken);
                      await setNativeAppGuard(next);
                      refreshNativeStatus();
                      toast.success(next ? 'Food App Guard active! 🛡️' : 'Food App Guard paused');
                    }}
                    className={`w-12 h-7 rounded-full transition-colors flex-shrink-0 p-0.5 ${
                      nativeStatus?.appGuardEnabled && nativeStatus?.hasUsageAccess
                        ? 'bg-blue-600'
                        : 'bg-gray-300'
                    }`}
                    aria-label="Toggle app open budget guard"
                  >
                    <span
                      className={`block w-6 h-6 bg-white rounded-full shadow transition-transform ${
                        nativeStatus?.appGuardEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {!nativeStatus?.hasUsageAccess ? (
                  <button
                    type="button"
                    onClick={openUsageAccessSettings}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    Allow Usage Access (to detect Swiggy / Zomato) →
                  </button>
                ) : (
                  <p className="text-xs text-emerald-700 font-semibold">✅ Usage Access Granted</p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div id="app-guard" className="space-y-4">
          {/* Android APK Zero-Setup Banner for Web Users */}
          <div className="card border border-blue-200 bg-gradient-to-br from-white to-blue-50/70">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <span>📲</span> MoneyMap Android App (Zero-Setup Auto-Track)
                </h2>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                  Want automatic UPI expense tracking and Swiggy/Zomato budget alerts without setting up MacroDroid? Install the MoneyMap Android APK and turn it on in 1 tap.
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href="https://github.com/bhanuprakashgowdu958-bit/moneymap/actions/workflows/android-apk.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5"
              >
                ⬇️ Get Android APK Build
              </a>
              <button
                type="button"
                onClick={() => setShowAdvancedAutomation((v) => !v)}
                className="btn-secondary text-xs py-2 px-3.5"
              >
                {showAdvancedAutomation ? 'Hide Manual Automation ▲' : 'Advanced: MacroDroid / iOS Shortcuts ▼'}
              </button>
            </div>
          </div>

          {showAdvancedAutomation && (
            <>
              {/* Real-Time Phone SMS / UPI Webhook */}
              <div className="card border border-emerald-500/20 bg-gradient-to-br from-white to-emerald-500/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📱</span>
            <h2 className="text-base font-semibold text-gray-900">Real-Time Phone SMS / UPI Auto-Sync</h2>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800 border border-emerald-300">
            Zero-Burden Sync ⚡
          </span>
        </div>
        <p className="text-xs text-gray-600 mb-4 leading-relaxed">
          Automatically log every UPI, card, or bank debit the second you receive an SMS on your phone — no manual statement uploads or Google email warnings needed.
        </p>

        {isDemoUser(user?.uid) ? (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            Sign in with a real Google/Email account to generate your personal SMS Webhook URL.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label text-xs">Your Personal Webhook URL (Keep Secret)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl || 'Generating...'}
                  className="input-field min-w-0 flex-1 text-xs font-mono bg-gray-50 text-gray-700"
                />
                <button
                  type="button"
                  onClick={handleCopyWebhook}
                  disabled={!webhookUrl}
                  className="btn-primary text-xs whitespace-nowrap px-3.5 flex-shrink-0"
                >
                  📋 Copy
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 mt-2.5 text-xs">
                <button
                  type="button"
                  onClick={handleTestWebhook}
                  disabled={testingWebhook || !webhookUrl}
                  className="text-emerald-700 hover:underline font-semibold py-1"
                >
                  {testingWebhook ? 'Sending test...' : '⚡ Send Test SMS'}
                </button>
                <button
                  type="button"
                  onClick={handleRegenerateWebhook}
                  disabled={loadingWebhook}
                  className="text-gray-500 hover:text-red-600 py-1"
                >
                  {loadingWebhook ? 'Regenerating...' : '🔄 Regenerate URL'}
                </button>
              </div>
            </div>

            {/* 60-Second Setup Guide Tabs */}
            <div className="bg-white rounded-xl border border-gray-200 p-3.5">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setGuideTab('ios')}
                  className={`text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg transition-all text-center ${
                    guideTab === 'ios' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                   iPhone
                </button>
                <button
                  type="button"
                  onClick={() => setGuideTab('android')}
                  className={`text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg transition-all text-center ${
                    guideTab === 'android' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  🤖 Android
                </button>
                <button
                  type="button"
                  disabled={!webhookUrl}
                  onClick={() => {
                    if (guideTab === 'ios') {
                      downloadIosGuidePdf(webhookUrl, displayName || 'User');
                      toast.success('iPhone Shortcuts Setup PDF downloaded! 📄');
                    } else {
                      downloadMacroDroidGuidePdf(webhookUrl, displayName || 'User');
                      toast.success('MacroDroid Setup Guide PDF downloaded! 📄');
                    }
                  }}
                  className="col-span-2 sm:col-span-1 sm:ml-auto text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                  title={`Download complete step-by-step ${guideTab === 'ios' ? 'iPhone Shortcuts' : 'Android MacroDroid'} PDF guide`}
                >
                  <span>📄</span> Download {guideTab === 'ios' ? 'iOS' : 'Android'} PDF
                </button>
              </div>

              {guideTab === 'ios' ? (
                <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside">
                  <li>Open the built-in <strong>Shortcuts</strong> app → <strong>Automation</strong> → <strong>+</strong>.</li>
                  <li>Choose <strong>Message</strong> → Message Contains <code className="bg-gray-100 px-1 rounded">debited</code> → <strong>Run Immediately</strong>.</li>
                  <li>Add action: <strong>Get Contents of URL</strong> → paste your Webhook URL above.</li>
                  <li>Set Method to <strong>POST</strong>, Request Body to <strong>JSON</strong>, key <code className="bg-gray-100 px-1 rounded">text</code> = <strong>Shortcut Input</strong>.</li>
                  <li>Optional: Read <code className="bg-gray-100 px-1 rounded">budgetAlert</code> from the response and show a notification if not empty.</li>
                </ol>
              ) : (
                <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside">
                  <li>Install <strong>MacroDroid</strong> (or SMS Forwarder) from Play Store.</li>
                  <li>Trigger: <strong>SMS Received</strong> (contains <code className="bg-gray-100 px-1 rounded">debited</code> or <code className="bg-gray-100 px-1 rounded">UPI</code>).</li>
                  <li>Action: <strong>HTTP Request (POST)</strong> → paste your Webhook URL above.</li>
                  <li>Content-Type <code className="bg-gray-100 px-1 rounded">text/plain</code>, Body: <code className="bg-gray-100 px-1 rounded">[sms_message]</code>.</li>
                  <li>The response includes <code className="bg-gray-100 px-1 rounded">budgetAlert</code> whenever that category crosses 80% or 100%.</li>
                </ol>
              )}
            </div>
          </div>
        )}
      </div>

      {/* App-Open Pre-Order Budget Guard */}
      <div className="card border border-amber-500/25 bg-gradient-to-br from-white to-amber-500/5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl flex-shrink-0">🛡️</span>
            <h2 className="text-base font-semibold text-gray-900 truncate">App-Open Budget Guard</h2>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 border border-amber-300 flex-shrink-0">
            Pre-Order Alert
          </span>
        </div>
        <p className="text-xs text-gray-600 mb-4 leading-relaxed">
          Warn yourself <strong>before</strong> ordering when you open Swiggy, Zomato, Blinkit, or shopping apps while a category is near or over its monthly limit.
        </p>

        {isDemoUser(user?.uid) ? (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            Sign in with a real Google/Email account to activate your App-Open Guard URL.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label text-xs">Category to Monitor</label>
              <select
                className="input-field text-sm py-2.5"
                value={guardCategory}
                onChange={(e) => setGuardCategory(e.target.value)}
              >
                {Object.entries(CATEGORIES)
                  .filter(([k]) => k !== 'other')
                  .map(([k, v]) => (
                    <option key={k} value={k}>{v.icon} {v.label}</option>
                  ))}
              </select>
            </div>

            <div>
              <label className="label text-xs">App-Open Alert Check URL (GET)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={guardTextUrl || 'Generating...'}
                  className="input-field min-w-0 flex-1 text-xs font-mono bg-gray-50 text-gray-700"
                />
                <button
                  type="button"
                  onClick={handleCopyGuardUrl}
                  disabled={!guardTextUrl}
                  className="btn-primary text-xs whitespace-nowrap px-3.5 flex-shrink-0"
                >
                  📋 Copy
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 mt-2.5 text-xs">
                <button
                  type="button"
                  onClick={handleTestGuard}
                  disabled={testingGuard || !guardJsonUrl}
                  className="text-amber-700 hover:underline font-semibold py-1"
                >
                  {testingGuard ? 'Checking budget...' : '🔔 Test Budget Alert Now'}
                </button>
                <span className="text-[11px] text-gray-400">Returns empty if under 80%</span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-3.5">
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setGuardTab('ios')}
                  className={`text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg transition-all text-center ${
                    guardTab === 'ios' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                   iPhone (App Open)
                </button>
                <button
                  type="button"
                  onClick={() => setGuardTab('android')}
                  className={`text-xs font-semibold px-3 py-2 sm:py-1.5 rounded-lg transition-all text-center ${
                    guardTab === 'android' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  🤖 Android (App Open)
                </button>
              </div>

              {guardTab === 'ios' ? (
                <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside">
                  <li>Open <strong>Shortcuts</strong> → <strong>Automation</strong> → <strong>+</strong> → choose <strong>App</strong>.</li>
                  <li>Select <strong>Swiggy</strong>, <strong>Zomato</strong>, etc. → choose <strong>Is Opened</strong> → <strong>Run Immediately</strong>.</li>
                  <li>Add <strong>Get Contents of URL</strong> (GET) with your Check URL above.</li>
                  <li>Add <strong>If</strong> <em>Contents of URL</em> <strong>has any value</strong> → <strong>Show Notification</strong> (or <strong>Show Alert</strong>) with <em>Contents of URL</em>.</li>
                </ol>
              ) : (
                <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside">
                  <li>In <strong>MacroDroid</strong>, tap <strong>Add Macro</strong> → Trigger: <strong>Applications → Application Launched</strong> (Swiggy, Zomato).</li>
                  <li>Action 1: <strong>HTTP Request (GET)</strong> → paste Check URL above → save response to local string variable <code className="bg-gray-100 px-1 rounded">alert_msg</code>.</li>
                  <li>Action 2: <strong>If</strong> <code className="bg-gray-100 px-1 rounded">[lv=alert_msg]</code> is not empty → <strong>Display Notification</strong> (or Popup Dialog) showing <code className="bg-gray-100 px-1 rounded">[lv=alert_msg]</code>.</li>
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
            </>
          )}
        </div>
      )}

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
          className="btn-danger w-full sm:w-auto flex items-center justify-center gap-2"
        >
          🚪 Sign Out from MoneyMap
        </button>
      </div>
    </div>
  );
}
