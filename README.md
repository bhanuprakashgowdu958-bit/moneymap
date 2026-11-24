# 💸 MoneyMap — Smart Expense Tracker

> Track every rupee, build every goal. A psychology-backed personal finance tracker built for Indian users.

## 🚀 Features

- **Quick Expense Logging** — Add any expense in under 5 seconds
- **13 Smart Categories** — Food Delivery, Groceries, Drinks, Transport, Subscriptions & more
- **Beautiful Dashboard** — Live stats, charts, and spending insights
- **Budget Manager** — Set category limits with real-time progress tracking
- **Behavioral Insights** — Opportunity cost visualizer, food delivery analysis
- **Safe-to-Spend Card** — Know exactly how much you can spend today
- **Weekly Spending Chart** — Area chart of last 7 days
- **Category Pie Chart** — Visual breakdown of monthly spending
- **Budget Alerts** — Color-coded warnings at 80% and 100% usage
- **Mobile-first Design** — Works perfectly on phone browsers

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Charts | Recharts |
| Backend | Node.js + Express |
| Database | MongoDB |
| Auth | JWT (JSON Web Tokens) |
| Routing | React Router v6 |

## 📦 Project Structure

```
Expense tracker/
├── backend/
│   ├── models/        # MongoDB schemas (User, Expense, Budget)
│   ├── routes/        # API routes (auth, expenses, budgets, dashboard)
│   ├── middleware/    # JWT auth middleware
│   ├── server.js      # Express entry point
│   └── .env           # Environment config
└── frontend/
    └── src/
        ├── components/ # Layout, ProtectedRoute
        ├── context/    # Auth context
        ├── lib/        # API client, constants, helpers
        └── pages/      # Login, Register, Dashboard, AddExpense, Expenses, Budgets, Insights, Settings
```

## 🔧 Setup & Installation

### Prerequisites
- Node.js v18+
- MongoDB (local or MongoDB Atlas)

### 1. Backend Setup

```bash
cd backend
npm install
# Copy and edit environment variables
copy .env.example .env
# Edit .env with your MongoDB URI and JWT secret
npm run dev
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

### 3. Access the App

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000/api

## 🌍 Environment Variables

**backend/.env:**
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/moneymap
JWT_SECRET=your_super_secret_key_here
NODE_ENV=development
```

**frontend/.env:**
```
VITE_API_URL=http://localhost:5000/api
```

## 📱 Pages

| Page | Route | Description |
|---|---|---|
| Login | `/login` | Sign in with email & password |
| Register | `/register` | Create account with optional income |
| Dashboard | `/dashboard` | Full financial overview |
| Add Expense | `/add-expense` | Quick expense logger |
| Expenses | `/expenses` | Full expense history with filters |
| Budgets | `/budgets` | Category budget manager |
| Insights | `/insights` | Charts, trends, behavioral insights |
| Settings | `/settings` | Profile & app preferences |

## 🎨 Design System

- **Primary:** Blue 600 (#2563eb)
- **Success:** Emerald 500 (#10b981)
- **Warning:** Amber 500 (#f59e0b)
- **Danger:** Red 500 (#ef4444)
- **Font:** Inter
- **Style:** Clean, professional, card-based layout

---

Built with ❤️ to help you track every single rupee.
