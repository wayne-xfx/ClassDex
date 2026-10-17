import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import RecaptchaWidget from "../components/RecaptchaWidget";
import { api } from "../api";
import { PageHeader } from "../components/DesignSystem";

export default function JoinClass() {
  const { classCode: inviteCode = "" } = useParams();
  const navigate = useNavigate();
  const [classCode, setClassCode] = useState(inviteCode.toUpperCase());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const captchaRef = useRef(null);
  const submitButtonRef = useRef(null);

  function handleSubmit(event) {
    event.preventDefault();
    if (joining) return;
    setError("");
    const normalizedCode = classCode.trim().toUpperCase();
    if (!normalizedCode) {
      setError("Enter a class invite code.");
      return;
    }
    if (!/^[A-Z0-9-]{3,20}$/.test(normalizedCode)) {
      setError("Use 3–20 letters, numbers, or hyphens.");
      return;
    }
    setCaptchaOpen(true);
  }

  async function submitWithToken(recaptchaToken) {
    if (joining) return;
    setJoining(true);
    try {
      const { enrollment, status, message } = await api.joinClass(classCode.trim().toUpperCase(), recaptchaToken);
      navigate("/student", { state: { notice: status === "PENDING" ? message || "Waiting for instructor approval." : `You joined ${enrollment.class.sectionName}.`, enrollmentStatus: status } });
    } catch (joinError) {
      if (joinError.status === "PENDING" || joinError.status === "APPROVED") {
        navigate("/student", { state: { notice: joinError.message, enrollmentStatus: joinError.status } });
      } else {
        setError(joinError.message);
      }
    } finally {
      setJoining(false);
      captchaRef.current?.reset();
      setCaptchaOpen(false);
    }
  }

  function handleCaptchaChange(token) {
    if (!token) return;
    captchaRef.current?.reset();
    setCaptchaOpen(false);
    void submitWithToken(token);
  }

  return (
    <AppShell active="home">
      <div className="content-narrow">
        <PageHeader
          eyebrow="Class invitation"
          icon="users"
          title="Join a class"
          description="Enter the invite code from your faculty member to add this class to your dashboard."
        />
        <form className="panel form-panel join-invite-panel" onSubmit={handleSubmit}>
          <div className="join-code-row">
            <label className="field">
              <span>Class invite code <b>*</b></span>
              <input className="input code-input" autoFocus value={classCode} onChange={(event) => setClassCode(event.target.value.toUpperCase())} placeholder="Enter class code" />
            </label>
            <button ref={submitButtonRef} type="submit" className="button button-primary" disabled={joining}>{joining ? "Joining…" : "Join class"} <Icon name="arrow" /></button>
          </div>
          {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
          <div className="form-actions join-form-actions">
            <Link to="/student" className="button button-quiet">Back to dashboard</Link>
          </div>
        </form>
        {captchaOpen ? <RecaptchaWidget ref={captchaRef} onChange={handleCaptchaChange} onClose={() => setCaptchaOpen(false)} returnFocusRef={submitButtonRef} /> : null}
      </div>
    </AppShell>
  );
}
