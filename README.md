# Hospital Indoor Navigation

User-centered hospital indoor navigation prototype built with:

- `Expo` + `React Native` for the mobile app
- `Flask` for the local backend
- `PostgreSQL` for monitoring event storage

This repository has two main parts:

- `hospital-app2/`: the mobile app
- `backend/`: the Python backend

Important: the repo root is not the Expo app root. Most mobile commands must be run inside `hospital-app2/`.

## Project Structure

- `hospital-app2/`: Expo mobile app
- `backend/app.py`: Flask backend
- `backend/data/`: navigation graph, floorplan, and hospital directory JSON files
- `hospital-app2/scripts/mock-tracking-keyboard.js`: local keyboard-based tracking simulator
- `hospital-app2/scripts/export_floormap.ps1`: floor map export script

## Prerequisites

Install these before starting:

- `Node.js` 18 or newer
- `npm`
- `Python` 3.10 or newer
- `PostgreSQL` 17
- Android development setup if you want to run on a phone/emulator:
  - Android Studio
  - Android SDK
  - USB debugging or an Android emulator

Recommended on Windows:

- PowerShell
- A Python virtual environment in the repo root named `.venv`

## Quick Start

If you only want to get the project running, follow these steps in order.

### 1. Clone the repository

```powershell
git clone <your-repository-url>
cd hospital-indoor-navigation
```

### 2. Create the Python virtual environment

If `.venv` does not already exist:

```powershell
python -m venv .venv
```

Activate it:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install backend dependencies:

```powershell
python -m pip install -r .\backend\requirements.txt
```

### 3. Create the PostgreSQL database

Create a database named:

```text
hospital_navigation
```

Then create `backend/.env` with:

```env
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/hospital_navigation
```

Notes:

- Replace `YOUR_PASSWORD` with your local PostgreSQL password.
- The backend will not start without `DATABASE_URL`.

### 4. Install mobile app dependencies

```powershell
cd .\hospital-app2
npm install
cd ..
```

### 5. Configure mobile environment variables

Create or update `hospital-app2/.env`.

Use your laptop's local IP address, not `localhost`, when testing on a real phone.

Example:

```env
EXPO_PUBLIC_NAV_DATA_URL=http://YOUR_PC_IP:4000/api/nav-data
EXPO_PUBLIC_DIRECTORY_URL=http://YOUR_PC_IP:4000/api/directory
EXPO_PUBLIC_MONITORING_INGEST_URL=http://YOUR_PC_IP:4000/api/monitoring
EXPO_PUBLIC_TRACKING_WS_URL=
```

Replace `YOUR_PC_IP` with something like `192.168.x.x`.

Notes:

- Use `http://YOUR_PC_IP:4000/...` for a real phone on the same Wi-Fi network.
- Use `http://localhost:4000/...` only if the app is running in an Android emulator on the same machine.
- Leave `EXPO_PUBLIC_TRACKING_WS_URL` empty if you do not want live tracking.
- The monitoring ingest endpoint should be `/api/monitoring`.

### 6. Start the backend

From the repo root:

```powershell
.\.venv\Scripts\python.exe .\backend\app.py
```

The backend runs on:

```text
http://localhost:4000
```

Quick health check:

```text
GET http://localhost:4000/health
```

### 7. Start Expo

Open a second terminal:

```powershell
cd .\hospital-app2
npx expo start --dev-client
```

### 8. Open the app on Android

If you already have the dev build installed:

- open the app on your phone
- keep the Expo terminal running

If you do not have the dev build installed yet:

```powershell
cd .\hospital-app2
npx expo run:android
```

## Available Backend Endpoints

The backend exposes these endpoints:

- `GET /health`
- `GET /api/nav-data`
- `GET /api/directory`
- `POST /api/monitoring`
- `GET /api/monitoring`
- `GET /api/monitoring/route-performance`



## Mock Tracking

You can simulate live movement from the keyboard.

Start the mock tracking server:

```powershell
cd .\hospital-app2
npm run mock:tracking
```

Then set `hospital-app2/.env`:

```env
EXPO_PUBLIC_TRACKING_WS_URL=ws://YOUR_PC_IP:8080
```

You can adjust the defaults in:

- `hospital-app2/scripts/mock-tracking-keyboard.js`

## Export Floor Map PNG

Generate a floor map image for documentation:

```powershell
cd .\hospital-app2
.\scripts\export_floormap.ps1
```