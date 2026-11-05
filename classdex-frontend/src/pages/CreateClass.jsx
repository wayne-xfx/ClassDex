import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import ClassForm from "../components/ClassForm";
import Icon from "../components/Icon";
import { api } from "../api";
import { PageHeader } from "../components/DesignSystem";

export default function CreateClass() {
  const navigate = useNavigate();

  async function handleCreateClass(payload) {
    const { class: createdClass } = await api.createClass(payload);
    navigate("/faculty", {
      state: {
        notice: `${createdClass.sectionName} is ready. Invite code: ${createdClass.classCode}`,
      },
    });
  }

  return (
    <AppShell active="home">
      <div className="content-narrow">
        <Link to="/faculty" className="back-link">
          <Icon name="chevron" /> Dashboard
        </Link>
        <PageHeader
          eyebrow="New classroom"
          icon="plus"
          title="Create a class"
          description="Set up a class space and share its invite code with students."
        />
        <ClassForm mode="create" cancelTo="/faculty" onSubmit={handleCreateClass} />
      </div>
    </AppShell>
  );
}
