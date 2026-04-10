# Running the AI Interview System

## 🏃 Day-to-Day Running (Quick Start)
Use these commands for your everyday development.

**Terminal 1: Run Frontend & Node API Together**
Open a terminal in the root folder (`/Users/maliktl/Documents/projects/AI-Interview-Final`) and run:
```bash
pnpm dev
```
*(This uses TurboRepo to launch BOTH the Next.js web app and the Node.js backend API at the same time).*

**Terminal 2: Run the Python AI Service**
Open a second terminal, navigate to the AI service, activate the environment, and start it:
```bash
cd services/ai-service
source venv/bin/activate  
uvicorn app.main:app --reload --port 8000
```

---

## 🛠 First-Time Setup (Only when cloning or adding dependencies)

If you just cloned the repo or someone added new packages, run these once:

**1. Python AI Service Setup:**
```bash
cd services/ai-service
python3 -m venv venv
source venv/bin/activate  
pip3 install -r requirements.txt
```

**2. Node API Backend Setup:**
```bash
cd apps/api
pnpm install
```

**3. Next/React Frontend Setup:**
```bash
cd apps/web
pnpm install
```
