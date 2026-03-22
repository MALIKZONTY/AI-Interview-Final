# 🚀 AI-Powered Role-Focused Interview System

An intelligent mock interview platform that generates role-based questions and evaluates candidates using AI techniques such as Natural Language Processing (NLP), Speech Analysis, and Computer Vision.

---

## 📌 Overview

This project helps users prepare for interviews through a realistic simulation. It analyzes a candidate’s **resume** and **job description** to generate personalized interview questions and evaluates their responses based on:

- Answer correctness
- Confidence level
- Communication skills

The system provides **detailed feedback and scores** to improve interview performance.

---

## 🧱 Tech Stack

### Frontend

- React (Vite)
- Tailwind CSS
- ShadCN UI
- Zustand (State Management)
- Axios

### Backend

- Node.js
- Fastify
- Prisma ORM
- JWT Authentication

### Database

- PostgreSQL

### Media Storage

- Cloudinary (Video & Audio)

### AI Service

- Python (FastAPI)
- NLP (TF-IDF / Embeddings)
- Speech-to-Text (Whisper)
- Computer Vision (OpenCV / MediaPipe)

### Monorepo

- Turborepo / pnpm workspaces

---

## 📁 Project Structure

```
apps/
  web/        # React frontend
  api/        # Fastify backend

services/
  ai-service/ # Python AI microservice

packages/
  ui/         # Shared UI components
  config/     # ESLint, TS configs
```

---

## 🔐 Features

### 👤 Authentication

- User Registration & Login
- JWT-based authentication
- Secure password validation

### 📄 Resume Management

- Upload resume (PDF)
- Stored in Cloudinary
- Auto-loaded on next login
- Update anytime

### 📑 Job Description (JD)

- Upload or paste JD
- Dynamic input per interview

### 🎯 Interview Setup

- Select number of questions (1–20)
- AI generates role-based questions

### 🎥 Mock Interview

- Camera & microphone access
- 30-second timer per question
- Real-time video + audio recording

### 🧠 AI Evaluation

Each response is analyzed using:

- **NLP** → Answer correctness
- **Speech Analysis** → Clarity, filler words
- **Computer Vision** → Confidence, eye contact

### 📊 Scoring System

- Per Question:
  - Correctness (%)
  - Confidence (%)

- Final Score:
  - Average of all questions

### 📈 Results Dashboard

- Overall score visualization
- Question-wise breakdown
- Speech-to-text answers displayed

### 🕓 Past Interviews

- View previous attempts
- Date & time tracking
- Detailed performance analysis

---

## 🔄 Application Flow

1. User signs up / logs in
2. Uploads resume (stored for reuse)
3. Uploads or enters job description
4. Selects number of questions
5. Starts interview (camera + mic access)
6. Answers questions (30 sec each)
7. System records responses
8. AI evaluates performance
9. Results displayed with scores
10. History stored for future review

---

## 🧠 AI Modules

### 1. NLP (Text Analysis)

- Resume & JD parsing
- Question generation
- Answer relevance scoring (cosine similarity)

### 2. Speech Analysis

- Speech-to-text conversion
- Words per minute
- Filler word detection

### 3. Computer Vision

- Face detection
- Eye contact tracking
- Head movement analysis

---

## 🗄️ Database Schema (Main Models)

- User
- Resume
- Interview
- Question
- Response
- Result

---

## ⚙️ Setup Instructions

### 1. Clone Repository

```bash
git clone https://github.com/your-username/ai-interview-system.git
cd ai-interview-system
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Setup Environment Variables

Create `.env` files in each service:

#### Backend

```
DATABASE_URL=
JWT_SECRET=
CLOUDINARY_URL=
```

#### AI Service

```
MODEL_PATH=
```

---

### 4. Run with Docker

```bash
docker-compose up --build
```

---

### 5. Run Locally (Optional)

Frontend:

```bash
cd apps/web
pnpm dev
```

Backend:

```bash
cd apps/api
pnpm dev
```

AI Service:

```bash
cd services/ai-service
uvicorn main:app --reload
```

---

## 📊 Future Enhancements

- 📄 Downloadable PDF report
- 🔁 Retake interview option
- 📱 Mobile optimization
- 🤖 Advanced AI models (LLMs)
- 🌐 Multi-language support

---

## 👨‍💻 Team

- A. Manoha Malik Paul
- A. Goutham Narayan
- G. Siddardha
- G. Phanitha
- I. Karthikeya

---

## 🎯 Conclusion

This system provides a **smart, scalable, and personalized interview preparation platform**, reducing dependency on manual evaluation and helping candidates improve effectively through AI-driven insights.

---

## ⭐ If you like this project, give it a star!
