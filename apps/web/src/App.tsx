import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuthStore } from "@/store/authStore";
import { LoginPage } from "@/pages/LoginPage";
import { SignupPage } from "@/pages/SignupPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { PreInterviewPage } from "@/pages/PreInterviewPage";
import { InterviewSessionPage } from "@/pages/InterviewSessionPage";
import { ProcessingPage } from "@/pages/ProcessingPage";
import { ResultsPage } from "@/pages/ResultsPage";
import { HistoryDetailPage } from "@/pages/HistoryDetailPage";

function HomeRedirect() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? "/" : "/login"} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/interview/prep" element={<PreInterviewPage />} />
          <Route path="/interview/session" element={<InterviewSessionPage />} />
          <Route path="/interview/processing/:id" element={<ProcessingPage />} />
          <Route path="/interview/results/:id" element={<ResultsPage />} />
          <Route path="/history/:id" element={<HistoryDetailPage />} />
        </Route>
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
