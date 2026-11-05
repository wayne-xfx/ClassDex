const API_BASE = "/api";
const SESSION_EXPIRED_KEY = "classdex:session-expired";
let memorySessionExpired = false;

export function markSessionExpiredNotice() {
  memorySessionExpired = true;
  try {
    window.sessionStorage.setItem(SESSION_EXPIRED_KEY, "1");
  } catch {
    // Fallback to in-memory flag when sessionStorage is unavailable.
  }
}

export function hasSessionExpiredNotice() {
  if (memorySessionExpired) return true;
  try {
    return window.sessionStorage.getItem(SESSION_EXPIRED_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearSessionExpiredNotice() {
  memorySessionExpired = false;
  try {
    window.sessionStorage.removeItem(SESSION_EXPIRED_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function isNetworkFailure(error) {
  if (!error) return false;
  if (error.name === "TypeError") return true;
  return /failed to fetch|networkerror|load failed/i.test(String(error.message || ""));
}

function fallbackStatusMessage(httpStatus) {
  if (httpStatus === 401) return "Your session expired. Please sign in again.";
  if (httpStatus === 403) return "You do not have permission to access this.";
  if (httpStatus === 404) return "The requested resource could not be found.";
  if (httpStatus >= 500) return "ClassDex ran into a server problem. Please try again in a moment.";
  return "Something went wrong.";
}

function buildRequestError(response, data = {}) {
  const hasServerMessage = typeof data.message === "string" && data.message.trim().length > 0;
  const requestError = new Error(
    hasServerMessage ? data.message : fallbackStatusMessage(response.status),
  );
  requestError.status = data.status;
  requestError.httpStatus = response.status;
  requestError.reason = data.reason;
  requestError.field = data.field;
  requestError.retryAfter = data.retryAfter;
  requestError.enrollment = data.enrollment;
  return requestError;
}

function dispatchUnauthorizedIfNeeded(path, response) {
  if (response.status === 401 && path !== "/auth/login" && path !== "/auth/me") {
    markSessionExpiredNotice();
    window.dispatchEvent(new CustomEvent("classdex:unauthorized"));
  }
}

async function fetchWithTimeout(path, fetchOptions = {}, callerSignal) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    return await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...fetchOptions,
      signal: callerSignal || controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError" && !callerSignal?.aborted) {
      throw new Error(
        "The server took too long to respond. Check that the backend and database are running, then try again.",
      );
    }
    if (isNetworkFailure(error)) {
      throw new Error("Can't reach ClassDex. Check your connection.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function request(path, options = {}) {
  const response = await fetchWithTimeout(
    path,
    {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    },
    options.signal,
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    dispatchUnauthorizedIfNeeded(path, response);
    throw buildRequestError(response, data);
  }
  return data;
}

async function requestBlob(path, options = {}) {
  const response = await fetchWithTimeout(path, options, options.signal);
  if (!response.ok) {
    dispatchUnauthorizedIfNeeded(path, response);
    const data = await response.json().catch(() => ({}));
    throw buildRequestError(response, data);
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
    }).then((data) => {
      clearSessionExpiredNotice();
      return data;
    }),
  logout: () =>
    request("/auth/logout", { method: "POST" }).finally(() => {
      clearSessionExpiredNotice();
    }),
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
  verifyEmail: (payload) =>
    request("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resendVerification: () =>
    request("/auth/resend-verification", {
      method: "POST",
    }),
  changePassword: (payload) =>
    request("/auth/change-password", {
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
  checkClassCode: (code, excludeId = "") =>
    request(
      `/classes/check-code?code=${encodeURIComponent(code)}${
        excludeId ? `&excludeId=${encodeURIComponent(excludeId)}` : ""
      }`,
    ),
  createClass: (payload) =>
    request("/classes", { method: "POST", body: JSON.stringify(payload) }),
  archiveClass: (id) =>
    request(`/classes/${encodeURIComponent(id)}/archive`, { method: "POST" }),
  restoreClass: (id) =>
    request(`/classes/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  classDetails: (id) => request(`/classes/${encodeURIComponent(id)}`),
  classDeck: (id) => request(`/classes/${encodeURIComponent(id)}/deck`),
  classRoster: (id) => request(`/classes/${encodeURIComponent(id)}/roster`),
  saveClassRoster: (id, entries) => request(`/classes/${encodeURIComponent(id)}/roster`, { method: "POST", body: JSON.stringify({ entries }) }),
  updateClassRosterEntry: (classId, entryId, payload) => request(`/classes/${encodeURIComponent(classId)}/roster/${encodeURIComponent(entryId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteClassRosterEntry: (classId, entryId) => request(`/classes/${encodeURIComponent(classId)}/roster/${encodeURIComponent(entryId)}`, { method: "DELETE" }),
  rosterImpact: (classId, entryId) => request(`/classes/${encodeURIComponent(classId)}/roster/${encodeURIComponent(entryId)}/impact`),
  dropList: (classId) => request(`/classes/${encodeURIComponent(classId)}/drop-list`),
  restoreDroppedStudent: (classId, entryId) => request(`/classes/${encodeURIComponent(classId)}/drop-list/${encodeURIComponent(entryId)}/restore`, { method: "POST" }),
  downloadRosterTemplate: (classId) => requestBlob(`/classes/${encodeURIComponent(classId)}/roster/template`),
  importRosterFile: (classId, payload) => request(`/classes/${encodeURIComponent(classId)}/roster/import`, { method: "POST", body: JSON.stringify(payload) }),
  pendingEnrollments: (classId) => request(`/classes/${encodeURIComponent(classId)}/pending`),
  markClassNotificationsRead: (classId) => request(`/classes/${encodeURIComponent(classId)}/notifications/read`, { method: "POST" }),
  markAbsenceWarningRead: (classId, studentId) => request(`/classes/${encodeURIComponent(classId)}/absence-warnings/${encodeURIComponent(studentId)}/read`, { method: "POST" }),
  updatePendingEnrollment: (classId, enrollmentId, status) => request(`/classes/${encodeURIComponent(classId)}/pending/${encodeURIComponent(enrollmentId)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  dismissAbsenceWarning: (classId, studentId) => request(`/classes/${encodeURIComponent(classId)}/absence-warnings/${encodeURIComponent(studentId)}/dismiss`, { method: "POST" }),
  quizSessions: (classId) => request(`/classes/${encodeURIComponent(classId)}/quizzes`),
  createQuizSession: (classId, payload) => request(`/classes/${encodeURIComponent(classId)}/quizzes`, { method: "POST", body: JSON.stringify(payload) }),
  updateQuizSession: (sessionId, payload) => request(`/quizzes/${encodeURIComponent(sessionId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteQuizSession: (sessionId) => request(`/quizzes/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  setQuizScoresBulk: (sessionId, scores) => request(`/quizzes/${encodeURIComponent(sessionId)}/scores`, { method: "PUT", body: JSON.stringify(scores) }),
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
  setBulkAttendance: (sessionId, updates) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/attendance`, {
      method: "PUT",
      body: JSON.stringify({ updates }),
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
