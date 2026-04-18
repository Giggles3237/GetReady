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

## Demo workflow notes

- `Ready / Complete` is blocked until:
  - detail has been finished
  - the vehicle has been removed from detail
  - required service work is complete when `needs_service` is true
  - required body work is complete when `needs_bodywork` is true
  - final QC is complete only if it has been required for that vehicle
- Parallel tasks like recall checks and fueling never block the main workflow
- Every update creates an audit entry with old and new values

## Deployment direction

- Frontend: Vercel or Netlify
- Backend: Azure App Service or Heroku-style Node host
- Database: Azure MySQL using the schema in `database/schema.sql`

