# AssetVerse Server 🏢📦

**Backend Repository – Corporate Asset Management System**
This is the **server-side** repository for **AssetVerse**, a full-stack B2B HR and asset management application. The backend provides secure APIs for authentication, role-based access control, asset management, request handling, employee affiliation, package management, and Stripe payment integration.

Built with Node.js, Express.js, MongoDB, and JWT for a scalable, production-ready architecture.

🔗 **Live Backend URL:** `http://localhost:5000`

🔗 **Client Repository:** [Link to your client repo](https://github.com/fardinislamselim/Asset-Verse-client)

🔗 **Live Demo (Frontend):** [https://assets-verse.web.app/](https://assets-verse.web.app/)

## 🚀 Key Backend Features

### 🔐 Authentication & Authorization

- JWT-based authentication middleware
- Role verification (HR / Employee)
- Protected routes
- Integration with Firebase Auth UID for user identification

### 🧑‍💼 Core Business Logic

- Company registration with default Basic Package (5 employees)
- Asset CRUD operations
- Asset request system (pending → approved/rejected)
- Auto-affiliation of employees on first approval
- Direct asset assignment to affiliated employees
- Return workflow for returnable assets
- Employee limit enforcement based on package
- Remove employees from company

### 💳 Payment Integration

- Stripe Checkout for package upgrades
- Webhook handling for successful payments
- Automatic package upgrade on successful payment

### 📊 Analytics Endpoints

- Returnable vs Non-returnable asset counts
- Top 5 most requested assets
- Real-time aggregation queries

### 🛡️ Security & Performance

- CORS configured for frontend origin
- Environment-based configuration
- Server-side pagination (`?page=&limit=`)
- Input validation and error handling
- Secure Stripe secret management

## 🛠️ Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB (with Mongoose ODM)
- **Authentication:** JSON Web Tokens (JWT)
- **Payments:** Stripe
- **Utilities:** dotenv, cors

## 📦 NPM Packages

```bash
express
mongoose
jsonwebtoken
bcryptjs          # (if password hashing is used)
cors
dotenv
stripe
nodemon           # dev dependency
```

## 🗄️ Database Collections (MongoDB)

- `users` – User profiles (name, email, role, image, firebaseUid)
- `companies` – Company details and HR reference
- `employeeaffiliations` – Links employees to companies
- `assets` – Company assets (type, name, returnable, etc.)
- `requests` – Employee asset requests (status: pending/approved/rejected)
- `assignedassets` – Currently assigned assets to employees
- `packages` – Available packages and pricing
- `payments` – Stripe payment records

## ⚙️ Environment Variables (`.env`)

Create a `.env` file in the root directory:

```env
PORT=5000

MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/assetverse

JWT_SECRET=your_very_strong_jwt_secret_key_here

STRIPE_SECRET_KEY=your_stripe_secret_key

```

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/fardinislamselim/Asset-Verse-server.git
cd assetverse-server
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create `.env` with your MongoDB URI, JWT secret, and Stripe keys.

### 4. Run Development Server

```bash
npm run dev
```

Server will run on `http://localhost:5000`

### 5. Build & Start for Production

```bash
npm start
```

## 🔗 API Endpoints Overview

| Method | Endpoint                        | Description                       | Protected |
| ------ | ------------------------------- | --------------------------------- | --------- |
| POST   | `/api/auth/login`               | Verify Firebase token & issue JWT | No        |
| POST   | `/api/companies`                | Register company (HR)             | Yes       |
| GET    | `/api/assets`                   | List assets (with pagination)     | Yes       |
| POST   | `/api/requests`                 | Employee requests asset           | Yes       |
| PATCH  | `/api/requests/:id/approve`     | HR approves request               | Yes (HR)  |
| POST   | `/api/payments/create-checkout` | Create Stripe checkout session    | Yes (HR)  |
| POST   | `/api/payments/webhook`         | Stripe webhook (raw body)         | No        |
| GET    | `/api/analytics/top-assets`     | Top requested assets              | Yes (HR)  |

_(Full API documentation can be added with Swagger/Postman if needed)_

## 🚀 Deployment

Recommended platforms:

- **Render** (free tier available)
- **Railway**
- **Railway + MongoDB Atlas**

Steps:

1. Connect repo
2. Add all environment variables
3. Set start command: `node src/server.js` or `npm start`
4. Ensure webhook URL is set in Stripe dashboard

## 🧪 Test Credentials (HR)

Use the frontend to register/login. Seed data should include:

- HR: `hr-1@assetsvers.com` (role: "hr")

## 🧑‍🤝‍🧑 Contributor

- **Your Name** – Full-Stack Developer  
  GitHub: [https://github.com/fardinislamselim](https://github.com/fardinislamselim)
