import Icon from "../Icon";

export default function PendingValidationList({ enrollments = [], onApprove, onDecline, busyId }) {
  return (
    <section className="panel pending-validation" aria-labelledby="pending-validation-title">
      <div className="pending-heading"><div><span className="eyebrow"><Icon name="users" /> Manual review</span><h2 id="pending-validation-title">Pending validation</h2><p>These students could not be matched to the official roster.</p></div><span className="pending-count">{enrollments.length} pending</span></div>
      {enrollments.length ? <div className="pending-list">{enrollments.map((enrollment) => { const student = enrollment.studentProfile; return <article className="pending-row" key={enrollment.id}><div className="pending-photo">{student.photo ? <img src={student.photo} alt="" /> : <Icon name="user" />}</div><div className="pending-student"><strong>{student.name}</strong><span>ID {student.studentId} · {student.program || "Program not set"} · {student.section || "Section not set"}</span><small>Submitted {new Date(enrollment.joinedAt).toLocaleString()}</small></div><div className="pending-actions"><button type="button" className="button button-primary" disabled={busyId === enrollment.id} onClick={() => onApprove(enrollment.id)}>Approve</button><button type="button" className="button button-quiet pending-decline" disabled={busyId === enrollment.id} onClick={() => { if (window.confirm("Decline this join request? The student may submit again later.")) onDecline(enrollment.id); }}>Decline</button></div></article>; })}</div> : <div className="empty-state pending-empty"><Icon name="check" /><strong>No pending requests</strong><span>Unmatched join requests will appear here for review.</span></div>}
    </section>
  );
}
