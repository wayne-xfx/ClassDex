import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ role }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-navy">
        Loading ClassDex…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (role && user.role !== role) {
    return (
      <Navigate
        to={user.role === "FACULTY" ? "/faculty" : "/student"}
        replace
      />
    );
  }

  return <Outlet />;
}

export function GuestRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-navy">
        Loading ClassDex…
      </div>
    );
  }

  if (user) {
    return (
      <Navigate
        to={user.role === "FACULTY" ? "/faculty" : "/student"}
        replace
      />
    );
  }

  return <Outlet />;
}
