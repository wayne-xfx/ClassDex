import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { api } from "../api";
import { PageHeader } from "../components/DesignSystem";

export default function JoinClass() {
  const { classCode: inviteCode = "" } = useParams();
  const navigate = useNavigate();
  const [classCode, setClassCode] = useState(inviteCode.toUpperCase());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setJoining(true);
    try {
      const { enrollment } = await api.joinClass(classCode);
      navigate("/student", { state: { notice: `You joined ${enrollment.class.sectionName}.` } });
    } catch (joinError) {
      setError(joinError.message);
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
          <label className="field">
            <span>Class invite code <b>*</b></span>
            <input className="input code-input" autoFocus required value={classCode} onChange={(event) => setClassCode(event.target.value.toUpperCase())} placeholder="Enter class code" />
          </label>
          {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
          <div className="form-actions">
            <Link to="/student" className="button button-quiet">Back to dashboard</Link>
            <button type="submit" className="button button-primary" disabled={joining}>{joining ? "Joining…" : "Join class"} <Icon name="arrow" /></button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
