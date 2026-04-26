# Get Ready Tracking System

Real-time vehicle tracking for dealership recon and front-line readiness.

## What is included

- React frontend with role-based dashboards
- Express backend with workflow validation and audit logging
- Seeded demo data for Sales, Service, Detail, BMW Genius, and Managers
- MySQL schema for Azure deployment

## Project structure

```text
client/   React app
server/   Express API
database/ MySQL schema
```

## Run locally

### 1. Backend

```bash
cd server
npm install
npm run migrate:auth
npm run dev
```

The API runs on `http://localhost:4000`.

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

The frontend runs on `http://localhost:5173`.

### 3. Capacitor iOS shell

Capacitor has been added under `client/` so the React app can run inside a native iOS container.

Important:

- You can prepare and sync the project from Windows
- You still need macOS with Xcode to build, sign, and run the iOS app
- For native builds, do not rely on `"/api"` unless your backend is available at the same origin

Frontend environment variables:

- `VITE_API_URL` for the normal web app when the frontend is not proxying `/api`
- `VITE_CAPACITOR_API_URL` for the native Capacitor app

Example:

```bash
VITE_API_URL=http://127.0.0.1:4000/api
VITE_CAPACITOR_API_URL=https://your-render-service.onrender.com/api
```

Capacitor commands:

```bash
cd client
npm run cap:sync
```

On a Mac:

```bash
cd client
npm run cap:open:ios
```

The backend now also allows common Capacitor origins such as `capacitor://localhost`, which is needed for authenticated requests from the native shell.

## Authentication

- The app now uses token-based login instead of browser session cookies
- The frontend stores the auth token locally and sends it with each API request
- Auth tokens default to a 90-day expiration
- Existing demo users can be bootstrapped with:

```bash
cd server
npm run migrate:auth
```

- Default migrated password: `ChangeMe123!`
- Users are forced to change that temporary password on first sign-in

## Demo workflow notes

- `Ready / Complete` is blocked until:
  - detail has been finished
  - the vehicle has been removed from detail and moved to warehouse for QC
  - required service work is complete when `needs_service` is true
  - required body work is complete when `needs_bodywork` is true
  - final QC is complete only if it has been required for that vehicle
- Parallel tasks like recall checks and fueling never block the main workflow
- Every update creates an audit entry with old and new values

## Deployment

### Recommended hosting

- Frontend: Vercel
- Backend: Render
- Database: Azure MySQL using `database/schema.sql`

### Render backend

The repo includes `render.yaml` at the project root for a Render web service blueprint.

Service details:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`

Required Render environment variables:

- `DB_HOST`
- `DB_PORT=3306`
- `DB_NAME=getready`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL=true`
- `SESSION_SECRET`
- `JWT_SECRET` optional, falls back to `SESSION_SECRET` if omitted
- `AUTH_TOKEN_TTL_DAYS` optional, defaults to `90`
- `BOPCHIPBOARD_API_KEY`
- `PORT=4000`

### Vercel frontend

The frontend lives in `client` and includes `client/vercel.json` for SPA rewrites.

Vercel project settings:

- Root directory: `client`
- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`

If the web frontend is hosted on Vercel, it can proxy `/api/*` requests to the Render backend so browser sessions stay first-party on mobile devices.

Current repo config:

- `client/vercel.json` rewrites `/api/(.*)` to `https://get-ready-api.onrender.com/api/$1`

For direct web-to-API deployments, set:

- `VITE_API_URL=https://your-render-service.onrender.com/api`

For native Capacitor builds, set:

- `VITE_CAPACITOR_API_URL=https://your-render-service.onrender.com/api`

## Bopchipboard integration

The backend now supports a dedicated integration endpoint for Netlify/server-to-server submission:

- `POST /api/integrations/bopchipboard/get-ready`

Authentication:

- header: `x-integration-key: <BOPCHIPBOARD_API_KEY>`

Recommended required payload:

```json
{
  "stock_number": "B12345",
  "year": 2024,
  "make": "BMW",
  "model": "X5",
  "color": "Black Sapphire Metallic",
  "due_date": "2026-04-20T14:00:00-04:00",
  "submitted_by_email": "chris@dealership.local",
  "notes": "Rush unit from chipboard"
}
```

Supported salesperson lookup fields:

- `submitted_by_user_id`
- `submitted_by_email`
- `submitted_by_name`
- aliases: `salesperson_id`, `salesperson_email`, `salesperson_name`, `advisor`

Optional convenience fields for chipboard payloads:

- `instructions`
- `comments`
- `location`
- `miles`
- `customer_name` / `customerName`
- `getReadyDate`
- `promiseTime`

If `needs_service` or `needs_bodywork` are omitted, the integration route can infer them from `instructions`.

### Local production checks

Before deploying:

```bash
cd server
npm start
```

```bash
cd client
npm run build
```
