import { Navigate, Route, Routes } from "react-router-dom";
import { GuestRoute, ProtectedRoute } from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<GuestRoute />}>
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
      </Route>
      <Route element={<ProtectedRoute role="FACULTY" />}>
        <Route
          path="/faculty"
          element={
            <Dashboard
              roleLabel="Faculty"
              nextHint="Your classes and create-class tools will live here in a later sprint."
            />
          }
        />
      </Route>
      <Route element={<ProtectedRoute role="STUDENT" />}>
        <Route
          path="/student"
          element={
            <Dashboard
              roleLabel="Student"
              nextHint="Your reusable index card and joined classes will live here in a later sprint."
            />
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
