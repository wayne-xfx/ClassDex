import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon";
import {
  doesClassMeetToday,
  formatManilaTodayChip,
  formatScheduleChip,
} from "../../utils/schedule";

export function ModuleHeader({ title, subtitle, actions, titleId, className = "" }) {
  return (
    <header className={`module-header${className ? ` ${className}` : ""}`}>
      <div className="module-header-copy">
        <h2 id={titleId}>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="module-header-actions">{actions}</div> : null}
    </header>
  );
}

export default function ClassShell({
  classRecord,
  activeModule,
  onModuleChange,
  studentListCount = 0,
  isArchived = false,
  archiveBusy = false,
  inviteQr = "",
  inviteQrError = "",
  onCopyInvite,
  onShowLargeQr,
  onEditClass,
  onArchiveClass,
  onRestoreClass,
  toast,
  children,
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inviteWrapRef = useRef(null);
  const inviteButtonRef = useRef(null);
  const menuWrapRef = useRef(null);
  const menuButtonRef = useRef(null);
  const tabRefs = useRef([]);

  const primaryTabs = useMemo(
    () => [
      { id: "deck", label: "Class deck" },
      { id: "attendance", label: "Attendance" },
      { id: "recitation", label: "Recitation" },
      { id: "activities", label: "Activities" },
      { id: "projects", label: "Projects" },
      { id: "quiz", label: "Quiz" },
    ],
    [],
  );

  const secondaryTabs = useMemo(
    () => [
      { id: "export", label: "Data export" },
      { id: "student-list", label: `Student List (${studentListCount})` },
    ],
    [studentListCount],
  );

  const allTabs = useMemo(
    () => [...primaryTabs, ...secondaryTabs],
    [primaryTabs, secondaryTabs],
  );

  useEffect(() => {
    if (!inviteOpen && !menuOpen) return undefined;

    function handleMouseDown(event) {
      if (inviteOpen && inviteWrapRef.current && !inviteWrapRef.current.contains(event.target)) {
        setInviteOpen(false);
      }
      if (menuOpen && menuWrapRef.current && !menuWrapRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (inviteOpen) {
          setInviteOpen(false);
          inviteButtonRef.current?.focus();
        }
        if (menuOpen) {
          setMenuOpen(false);
          menuButtonRef.current?.focus();
        }
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [inviteOpen, menuOpen]);

  function handleTabKeyDown(event, index) {
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % allTabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + allTabs.length) % allTabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? allTabs.length - 1
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = allTabs[nextIndex];
    onModuleChange(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  }

  function handleMenuKeyDown(event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = menuWrapRef.current
      ? [...menuWrapRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')]
      : [];
    if (!items.length) return;
    event.preventDefault();
    const currentIdx = items.indexOf(document.activeElement);
    const nextIdx =
      event.key === "ArrowDown"
        ? (currentIdx + 1) % items.length
        : (currentIdx - 1 + items.length) % items.length;
    items[nextIdx]?.focus();
  }

  const todayChip = formatManilaTodayChip();
  const scheduleChip = formatScheduleChip(classRecord);
  const meetsToday = doesClassMeetToday(classRecord);
  const isDeck = activeModule === "deck";
  const description = classRecord?.description?.trim() || "";

  return (
    <div className="class-shell">
      <header className="class-shell-header">
        <div className="class-shell-header-main">
          <Link to="/faculty" className="class-shell-back">
            <Icon name="arrowLeft" size={16} />
            <span>Dashboard</span>
          </Link>

          <div className={`class-shell-heading${isDeck ? " is-deck" : ""}`}>
            <div className="class-shell-title-row">
              <h1>{classRecord.sectionName}</h1>
              {isArchived ? (
                <span className="enrolled-pill enrolled-pill-archived">
                  <Icon name="archive" size={13} /> Archived
                </span>
              ) : null}
            </div>
            {isDeck && description ? (
              <p className="class-shell-description" title={description}>
                {description}
              </p>
            ) : null}
          </div>

          <div className="class-shell-chips">
            <span className="class-shell-chip class-shell-date-chip">
              <Icon name="calendar" size={14} />
              <span>Today · {todayChip}</span>
            </span>

            <span
              className={`class-shell-chip class-shell-schedule-chip${meetsToday ? " is-today" : ""}`}
            >
              {meetsToday ? (
                <span className="class-shell-today-indicator">
                  <Icon name="check" size={13} />
                  <span>Today</span>
                </span>
              ) : (
                <Icon name="clock" size={14} />
              )}
              <span className="class-shell-schedule-text">{scheduleChip}</span>
            </span>
          </div>
        </div>

        {!isArchived ? (
          <div className="class-shell-header-actions">
            <div className="class-shell-popover-anchor" ref={inviteWrapRef}>
              <button
                ref={inviteButtonRef}
                type="button"
                className={`button button-secondary button-small class-shell-invite-btn${inviteOpen ? " is-open" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={inviteOpen}
                aria-controls="class-shell-invite-popover"
                onClick={() => {
                  setMenuOpen(false);
                  setInviteOpen((open) => !open);
                }}
              >
                <Icon name="qrCode" size={15} />
                <span>Invite</span>
              </button>

              {inviteOpen ? (
                <div
                  id="class-shell-invite-popover"
                  className="class-shell-invite-popover"
                  role="dialog"
                  aria-label={`Invite students to ${classRecord.sectionName}`}
                >
                  <div className="class-shell-invite-code-row">
                    <span className="class-shell-invite-code-label">Class code</span>
                    <strong className="class-shell-invite-code-badge">{classRecord.classCode}</strong>
                  </div>

                  <button
                    type="button"
                    className="button button-primary class-shell-invite-copy"
                    onClick={onCopyInvite}
                  >
                    <Icon name="copy" size={16} />
                    <span>Copy invite link</span>
                  </button>

                  <div className="class-shell-invite-qr-section">
                    {inviteQr ? (
                      <>
                        <img
                          src={inviteQr}
                          alt={`QR code for joining ${classRecord.sectionName}`}
                          className="class-shell-invite-qr-img"
                        />
                        <div className="class-shell-invite-qr-actions">
                          <button
                            type="button"
                            className="button button-quiet button-small"
                            onClick={() => {
                              setInviteOpen(false);
                              onShowLargeQr?.();
                            }}
                          >
                            Show larger
                          </button>
                          <a
                            href={inviteQr}
                            download={`${classRecord.classCode || "class"}-qr.png`}
                            className="button button-quiet button-small"
                          >
                            <Icon name="download" size={14} /> Download QR
                          </a>
                        </div>
                      </>
                    ) : (
                      <div className="class-shell-invite-qr-placeholder">Generating QR…</div>
                    )}
                    {inviteQrError ? (
                      <span className="class-shell-invite-error">{inviteQrError}</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div
              className="class-shell-popover-anchor"
              ref={menuWrapRef}
              onKeyDown={handleMenuKeyDown}
            >
              <button
                ref={menuButtonRef}
                type="button"
                className={`icon-button class-shell-more-btn${menuOpen ? " is-open" : ""}`}
                aria-label="More class actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls="class-shell-overflow-menu"
                onClick={() => {
                  setInviteOpen(false);
                  setMenuOpen((open) => !open);
                }}
              >
                <Icon name="moreHorizontal" size={18} />
              </button>

              {menuOpen ? (
                <div
                  id="class-shell-overflow-menu"
                  className="class-shell-overflow-menu"
                  role="menu"
                  aria-label="Class actions"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="class-shell-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onEditClass?.();
                    }}
                  >
                    <Icon name="edit" size={16} />
                    <span>Edit class</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="class-shell-menu-item class-shell-menu-item-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      onArchiveClass?.();
                    }}
                  >
                    <Icon name="archive" size={16} />
                    <span>Archive class</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      {isArchived ? (
        <section
          className="panel archived-class-banner"
          role="status"
          aria-label="Archived class status"
        >
          <div className="archived-class-banner-copy">
            <span className="archived-class-badge">
              <Icon name="archive" size={16} /> Archived · Read-only
            </span>
            <p>
              This class is archived. Student records, attendance, recitations, activities,
              projects, quizzes, and exports remain viewable, while edits and new joins are paused.
            </p>
          </div>
          <button
            type="button"
            className="button button-primary button-small"
            onClick={onRestoreClass}
            disabled={archiveBusy}
          >
            {archiveBusy ? "Restoring…" : "Restore class"}
          </button>
        </section>
      ) : null}

      <div className="class-shell-tabs-wrap">
        <div className="class-shell-tabs" role="tablist" aria-label="Class modules">
          <div className="class-shell-tab-group">
            {primaryTabs.map((tab, groupIdx) => (
              <button
                key={tab.id}
                id={`module-tab-${tab.id}`}
                type="button"
                role="tab"
                className={`class-shell-tab${activeModule === tab.id ? " is-active" : ""}`}
                aria-selected={activeModule === tab.id}
                aria-controls={`module-panel-${tab.id}`}
                tabIndex={activeModule === tab.id ? 0 : -1}
                ref={(el) => {
                  tabRefs.current[groupIdx] = el;
                }}
                onKeyDown={(event) => handleTabKeyDown(event, groupIdx)}
                onClick={() => {
                  setInviteOpen(false);
                  setMenuOpen(false);
                  onModuleChange(tab.id);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="class-shell-tab-group class-shell-tab-group-secondary">
            <span className="class-shell-tab-divider" aria-hidden="true" />
            {secondaryTabs.map((tab, secIdx) => {
              const index = primaryTabs.length + secIdx;
              return (
                <button
                  key={tab.id}
                  id={`module-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  className={`class-shell-tab${activeModule === tab.id ? " is-active" : ""}`}
                  aria-selected={activeModule === tab.id}
                  aria-controls={`module-panel-${tab.id}`}
                  tabIndex={activeModule === tab.id ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  onClick={() => {
                    setInviteOpen(false);
                    setMenuOpen(false);
                    onModuleChange(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {toast}

      <section
        id={`module-panel-${activeModule}`}
        role="tabpanel"
        aria-labelledby={`module-tab-${activeModule}`}
        className="classroom-module"
      >
        {children}
      </section>
    </div>
  );
}
