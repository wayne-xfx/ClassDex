import { Navigate, Route, Routes } from "react-router-dom";
import { GuestRoute, ProtectedRoute } from "./components/ProtectedRoute";
import CreateClass from "./pages/CreateClass";
import FacultyClass from "./pages/FacultyClass";
import FacultyDashboard from "./pages/FacultyDashboard";
import FacultyProfile from "./pages/FacultyProfile";
import JoinClass from "./pages/JoinClass";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import StudentDashboard from "./pages/StudentDashboard";
import StudentProfile from "./pages/StudentProfile";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<GuestRoute />}>
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
      </Route>
      <Route element={<ProtectedRoute role="FACULTY" />}>
        <Route path="/faculty" element={<FacultyDashboard />} />
        <Route path="/faculty/profile" element={<FacultyProfile />} />
        <Route path="/faculty/classes/new" element={<CreateClass />} />
        <Route path="/faculty/classes/:id" element={<FacultyClass />} />
      </Route>
      <Route element={<ProtectedRoute role="STUDENT" />}>
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/student/profile" element={<StudentProfile />} />
        <Route path="/join" element={<JoinClass />} />
        <Route path="/join/:classCode" element={<JoinClass />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
