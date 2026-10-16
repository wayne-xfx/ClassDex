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
  const [recaptchaToken, setRecaptchaToken] = useState("");
  const captchaRef = useRef(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!recaptchaToken) {
      setError("Please complete the security check.");
      return;
    }
    setJoining(true);
    try {
      const { enrollment, status, message } = await api.joinClass(classCode, recaptchaToken);
      navigate("/student", { state: { notice: status === "PENDING" ? message || "Waiting for instructor approval." : `You joined ${enrollment.class.sectionName}.`, enrollmentStatus: status } });
    } catch (joinError) {
      captchaRef.current?.reset();
      if (joinError.status === "PENDING" || joinError.status === "APPROVED") {
        navigate("/student", { state: { notice: joinError.message, enrollmentStatus: joinError.status } });
      } else {
        setError(joinError.message);
      }
    } finally {
      setJoining(false);
    }
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
              <input className="input code-input" autoFocus required value={classCode} onChange={(event) => setClassCode(event.target.value.toUpperCase())} placeholder="Enter class code" />
            </label>
            <button type="submit" className="button button-primary" disabled={joining}>{joining ? "Joining…" : "Join class"} <Icon name="arrow" /></button>
          </div>
          <RecaptchaWidget ref={captchaRef} onChange={setRecaptchaToken} />
          {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
          <div className="form-actions join-form-actions">
            <Link to="/student" className="button button-quiet">Back to dashboard</Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
