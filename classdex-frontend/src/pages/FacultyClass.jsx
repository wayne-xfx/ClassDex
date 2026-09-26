import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { api } from "../api";

export default function FacultyClass() {
  const { id } = useParams();
  const [classRecord, setClassRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .classDetails(id)
      .then(({ class: record }) => {
        if (!cancelled) setClassRecord(record);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function copyInvite() {
    const link = `${window.location.origin}/join/${classRecord.classCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Invite link copied to clipboard.");
    } catch {
      setNotice(`Invite link: ${link}`);
    }
  }

  return (
    <AppShell active="home">
      <div className="content-wide">
        <Link to="/faculty" className="back-link"><Icon name="chevron" /> All classes</Link>
        {loading ? <div className="loading-card">Loading class roster…</div> : error ? <p className="notice notice-error" role="alert">{error}</p> : classRecord ? (
          <>
            <header className="class-detail-heading">
              <div>
                <span className="eyebrow"><Icon name="book" /> Class roster</span>
                <h1>{classRecord.sectionName}</h1>
                <p>{classRecord.description || "Your class and student roster."}</p>
              </div>
              <button type="button" className="button button-primary" onClick={copyInvite}><Icon name="copy" /> Copy invite link</button>
            </header>
            {notice ? <p className="notice notice-success" role="status">{notice}</p> : null}
            <div className="detail-stats">
              <div className="panel stat-card"><span className="stat-icon"><Icon name="users" /></span><div><strong>{classRecord.enrollments.length}</strong><span>Students enrolled</span></div></div>
              <div className="panel stat-card"><span className="stat-icon stat-amber"><Icon name="clock" /></span><div><strong>{classRecord.schedule || "Not set"}</strong><span>Class schedule</span></div></div>
              <div className="panel stat-card"><span className="stat-icon stat-teal"><Icon name="copy" /></span><div><strong>{classRecord.classCode}</strong><span>Invite code</span></div></div>
            </div>
            <section className="panel roster-panel">
              <div className="section-heading">
                <div><h2>Student roster</h2><p>Students who joined with this class code or invite link.</p></div>
              </div>
              {classRecord.enrollments.length ? (
                <div className="roster-list">
                  {classRecord.enrollments.map(({ id: enrollmentId, studentProfile }) => (
                    <article className="roster-row" key={enrollmentId}>
                      <div className="roster-avatar">{studentProfile.photo ? <img src={studentProfile.photo} alt="" /> : <Icon name="user" />}</div>
                      <div className="roster-name"><strong>{studentProfile.name}</strong><span>{studentProfile.program || "Program not provided"}{studentProfile.section ? ` · ${studentProfile.section}` : ""}</span></div>
                      <span className="student-number">{studentProfile.studentId}</span>
                      <span className="muted roster-email">{studentProfile.email}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-roster"><div className="empty-art"><Icon name="users" /></div><h3>No students yet</h3><p>Share the class invite link or code to get started.</p></div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
