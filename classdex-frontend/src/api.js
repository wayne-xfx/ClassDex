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
    if (response.status === 401 && path !== "/auth/login" && path !== "/auth/me") {
      window.dispatchEvent(new CustomEvent("classdex:unauthorized"));
    }
    const requestError = new Error(data.message || "Something went wrong.");
    requestError.status = data.status;
    requestError.httpStatus = response.status;
    requestError.reason = data.reason;
    requestError.field = data.field;
    requestError.retryAfter = data.retryAfter;
    requestError.enrollment = data.enrollment;
    throw requestError;
  }
  return data;
}

async function requestBlob(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Something went wrong.");
  }
  return response.blob();
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
  forgotPassword: (payload) =>
    request("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  validateResetToken: (token) =>
    request(`/auth/reset-password/validate?token=${encodeURIComponent(token || "")}`),
  resetPassword: (payload) =>
    request("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  facultyProfile: (options = {}) =>
    request(`/faculty/profile${options.summary ? "?summary=1" : ""}`),
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
  facultyPendingCounts: () => request("/faculty/classes/pending-counts"),
  studentClasses: () => request("/student/classes"),
  checkClassCode: (code) =>
    request(`/classes/check-code?code=${encodeURIComponent(code)}`),
  createClass: (payload) =>
    request("/classes", { method: "POST", body: JSON.stringify(payload) }),
  classDetails: (id) => request(`/classes/${encodeURIComponent(id)}`),
  classDeck: (id) => request(`/classes/${encodeURIComponent(id)}/deck`),
  classRoster: (id) => request(`/classes/${encodeURIComponent(id)}/roster`),
  saveClassRoster: (id, entries) => request(`/classes/${encodeURIComponent(id)}/roster`, { method: "POST", body: JSON.stringify({ entries }) }),
  updateClassRosterEntry: (classId, entryId, payload) => request(`/classes/${encodeURIComponent(classId)}/roster/${encodeURIComponent(entryId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteClassRosterEntry: (classId, entryId) => request(`/classes/${encodeURIComponent(classId)}/roster/${encodeURIComponent(entryId)}`, { method: "DELETE" }),
  pendingEnrollments: (classId) => request(`/classes/${encodeURIComponent(classId)}/pending`),
  markClassNotificationsRead: (classId) => request(`/classes/${encodeURIComponent(classId)}/notifications/read`, { method: "POST" }),
  markAbsenceWarningRead: (classId, studentId) => request(`/classes/${encodeURIComponent(classId)}/absence-warnings/${encodeURIComponent(studentId)}/read`, { method: "POST" }),
  updatePendingEnrollment: (classId, enrollmentId, status) => request(`/classes/${encodeURIComponent(classId)}/pending/${encodeURIComponent(enrollmentId)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  dismissAbsenceWarning: (classId, studentId) => request(`/classes/${encodeURIComponent(classId)}/absence-warnings/${encodeURIComponent(studentId)}/dismiss`, { method: "POST" }),
  quizSessions: (classId) => request(`/classes/${encodeURIComponent(classId)}/quizzes`),
  createQuizSession: (classId, payload) => request(`/classes/${encodeURIComponent(classId)}/quizzes`, { method: "POST", body: JSON.stringify(payload) }),
  updateQuizSession: (sessionId, payload) => request(`/quizzes/${encodeURIComponent(sessionId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteQuizSession: (sessionId) => request(`/quizzes/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  setQuizScore: (sessionId, studentId, score) => request(`/quizzes/${encodeURIComponent(sessionId)}/scores/${encodeURIComponent(studentId)}`, { method: "PUT", body: JSON.stringify({ score }) }),
  studentClassRecord: (classId) =>
    request(`/student/classes/${encodeURIComponent(classId)}/records`),
  exportClassExcel: (classId, types) => {
    const params = types?.length ? `?types=${types.map(encodeURIComponent).join(",")}` : "";
    return requestBlob(`/classes/${encodeURIComponent(classId)}/export/excel${params}`);
  },
  exportClassCsv: (classId, types) => {
    const params = types?.length ? `?types=${types.map(encodeURIComponent).join(",")}` : "";
    return requestBlob(`/classes/${encodeURIComponent(classId)}/export/csv${params}`);
  },
  studentClassRecords: (classId, studentId) =>
    request(`/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/records`),
  todaySession: (id, payload = {}) =>
    request(`/classes/${encodeURIComponent(id)}/sessions/today`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  startAttendanceSession: (sessionId) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/start`, {
      method: "POST",
    }),
  updateClass: (id, payload) =>
    request(`/classes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  setAttendance: (sessionId, studentId, status) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/attendance/${encodeURIComponent(studentId)}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
  shuffleRecitation: (sessionId, mode, excludeStudentId = null) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/recitation/shuffle`, {
      method: "POST",
      body: JSON.stringify({
        mode,
        ...(excludeStudentId ? { excludeStudentId } : {}),
      }),
    }),
  updateRecitationScore: (logId, score) =>
    request(`/recitation-logs/${encodeURIComponent(logId)}`, {
      method: "PATCH",
      body: JSON.stringify({ score }),
    }),
  sessionActivities: (sessionId) => request(`/sessions/${encodeURIComponent(sessionId)}/activities`),
  createActivity: (sessionId, payload) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/activities`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateActivity: (activityId, payload) =>
    request(`/activities/${encodeURIComponent(activityId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteActivity: (activityId) =>
    request(`/activities/${encodeURIComponent(activityId)}`, { method: "DELETE" }),
  activityScores: (activityId) => request(`/activities/${encodeURIComponent(activityId)}/scores`),
  setActivityScore: (activityId, studentId, score) =>
    request(`/activities/${encodeURIComponent(activityId)}/scores/${encodeURIComponent(studentId)}`, {
      method: "PUT",
      body: JSON.stringify({ score }),
    }),
  classProjects: (classId) => request(`/classes/${encodeURIComponent(classId)}/projects`),
  updateProject: (projectId, payload) =>
    request(`/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  projectScores: (projectId) => request(`/projects/${encodeURIComponent(projectId)}/scores`),
  setProjectScore: (projectId, studentId, score, sessionId) =>
    request(`/projects/${encodeURIComponent(projectId)}/scores/${encodeURIComponent(studentId)}`, {
      method: "PUT",
      body: JSON.stringify({ score, sessionId }),
    }),
  joinClass: (classCode, recaptchaToken) =>
    request("/classes/join", {
      method: "POST",
      body: JSON.stringify({ classCode, recaptchaToken }),
    }),
};
