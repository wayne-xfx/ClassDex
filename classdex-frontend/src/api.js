const API_BASE = "/api";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError" && !options.signal?.aborted) {
      throw new Error("The server took too long to respond. Check that the backend and database are running, then try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Something went wrong.");
  }
  return data;
}

export const api = {
  register: (payload) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),
  facultyProfile: () => request("/faculty/profile"),
  saveFacultyProfile: (payload) =>
    request("/faculty/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  studentProfile: () => request("/student/profile"),
  saveStudentProfile: (payload) =>
    request("/student/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  facultyClasses: () => request("/faculty/classes"),
  studentClasses: () => request("/student/classes"),
  checkClassCode: (code) =>
    request(`/classes/check-code?code=${encodeURIComponent(code)}`),
  createClass: (payload) =>
    request("/classes", { method: "POST", body: JSON.stringify(payload) }),
  classDetails: (id) => request(`/classes/${encodeURIComponent(id)}`),
  joinClass: (classCode) =>
    request("/classes/join", {
      method: "POST",
      body: JSON.stringify({ classCode }),
    }),
};
