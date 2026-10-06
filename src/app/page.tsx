"use client";
import { useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  Command,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  X,
} from "lucide-react";
import {
  auth,
  db,
  firebaseMissing,
  firebaseReady,
  isFirebaseEmulator,
} from "@/lib/firebase";
import { addItem, changeTask, ensureWorkspace, type Item } from "@/lib/data";
import {
  dateKeyInTimezone,
  detectBrowserTimezone,
  formatDateInTimezone,
  formatInstantInTimezone,
  previousSevenDayKeys,
  toUtcInstant,
} from "@/lib/timezone";

const nav = [
  {
    label: "Workspace",
    items: [
      { name: "Overview", icon: LayoutDashboard },
      { name: "My tasks", icon: ListTodo },
      { name: "Commitments", icon: Target },
      { name: "Projects", icon: FolderKanban },
      { name: "Calendar", icon: CalendarDays },
      { name: "Activity", icon: Activity },
    ],
  },
  {
    label: "Manage",
    items: [
      { name: "Team", icon: Users },
      { name: "Settings", icon: Settings },
    ],
  },
];
const statuses = ["Planned", "In Progress", "Blocked", "Completed"];
const commonTimezones = [
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];
const timezoneOptions = Array.from(
  new Set([
    ...(typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : commonTimezones),
    ...commonTimezones,
  ]),
).sort();
function dueInstant(item: Item): Date | null {
  const value = item.dueAt ?? item.dueDate;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) {
    const parsed = new Date(value.includes("T") ? value : `${value}T23:59:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
function formatDue(item: Item, timezone: string) {
  const date = dueInstant(item);
  if (!date) return "No due date";
  try {
    return formatInstantInTimezone(date, timezone);
  } catch {
    return formatInstantInTimezone(date, "UTC");
  }
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null),
    [teamId, setTeamId] = useState(""),
    [profile, setProfile] = useState<any>(null);
  const [section, setSection] = useState("Overview"),
    [tasks, setTasks] = useState<Item[]>([]),
    [commitments, setCommitments] = useState<Item[]>([]),
    [projects, setProjects] = useState<Item[]>([]),
    [activity, setActivity] = useState<Item[]>([]);
  const [modal, setModal] = useState(""),
    [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState("Medium"),
    [busy, setBusy] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [toast, setToast] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All status");
  const [detectedZone, setDetectedZone] = useState("UTC");
  const [zone, setZone] = useState("UTC");
  const [timezoneDraft, setTimezoneDraft] = useState("UTC");
  const [timezonePrompt, setTimezonePrompt] = useState<{
    previous: string;
    detected: string;
  } | null>(null);
  const checkedTimezoneUid = useRef("");
  useEffect(() => {
    const detected = detectBrowserTimezone();
    setDetectedZone(detected);
    setZone(detected);
    setTimezoneDraft(detected);
    return onAuthStateChanged(auth, setUser);
  }, []);
  useEffect(() => {
    if (!user) return;
    const checkBrowserTimezone = () => {
      const detected = detectBrowserTimezone();
      if (detected !== detectedZone) {
        setDetectedZone(detected);
        if (detected !== zone) {
          setTimezonePrompt({ previous: zone, detected });
        }
      }
    };
    window.addEventListener("focus", checkBrowserTimezone);
    return () => window.removeEventListener("focus", checkBrowserTimezone);
  }, [user, detectedZone, zone]);
  useEffect(() => {
    if (!user) {
      setTeamId("");
      checkedTimezoneUid.current = "";
      setTimezonePrompt(null);
      return;
    }
    let live = true;
    const timezone = zone;
    ensureWorkspace(user.uid, {
      displayName: user.displayName || "Founder",
      email: user.email || "demo@founderos.local",
      photoURL: user.photoURL,
      timezone,
    })
      .then((id) => live && setTeamId(id))
      .catch(() =>
        setToast("Could not load your workspace. Check Firebase is running."),
      );
    return () => {
      live = false;
    };
  }, [user, zone]);
  useEffect(() => {
    if (!teamId) return;
    const subs = [
      onSnapshot(
        query(
          collection(db, "teams", teamId, "tasks"),
          orderBy("createdAt", "desc"),
        ),
        (s) => setTasks(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Item)),
      ),
      onSnapshot(
        query(
          collection(db, "teams", teamId, "commitments"),
          orderBy("createdAt", "desc"),
        ),
        (s) =>
          setCommitments(
            s.docs.map((d) => ({ id: d.id, ...d.data() }) as Item),
          ),
      ),
      onSnapshot(
        query(
          collection(db, "teams", teamId, "projects"),
          orderBy("createdAt", "desc"),
        ),
        (s) =>
          setProjects(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Item)),
      ),
      onSnapshot(
        query(
          collection(db, "teams", teamId, "activity"),
          orderBy("createdAt", "desc"),
          limit(25),
        ),
        (s) =>
          setActivity(
            s.docs.slice(0, 25).map((d) => ({ id: d.id, ...d.data() }) as Item),
          ),
      ),
      onSnapshot(doc(db, "users", user!.uid), (s) => {
        const nextProfile = s.data() || {};
        setProfile(nextProfile);
        setTimezoneDraft(nextProfile.timezone || detectedZone);
        if (nextProfile.timezone && checkedTimezoneUid.current !== user!.uid) {
          checkedTimezoneUid.current = user!.uid;
          setZone(nextProfile.timezone);
          if (
            !nextProfile.timezoneConfirmed ||
            nextProfile.timezone !== detectedZone
          ) {
            setTimezonePrompt({
              previous: nextProfile.timezone,
              detected: detectedZone,
            });
          }
        }
      }),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, [teamId, user, detectedZone]);
  const open = (kind: string) => {
    setTitle("");
    setDue("");
    setPriority("Medium");
    setModal(kind);
  };
  const create = async () => {
    if (!title.trim() || !teamId || !user || (modal !== "project" && !due))
      return;
    setBusy(true);
    try {
      await addItem(
        teamId,
        modal === "commitment"
          ? "commitments"
          : modal === "project"
            ? "projects"
            : "tasks",
        modal === "commitment"
          ? {
              description: title.trim(),
              status: "Active",
              priority,
              ownerUid: user.uid,
              dueAt: toUtcInstant(due, zone),
              timezone: zone,
            }
          : {
              title: title.trim(),
              status: modal === "project" ? "Active" : "Planned",
              priority,
              ownerUid: user.uid,
              ...(modal === "project"
                ? {}
                : { dueAt: toUtcInstant(due, zone), timezone: zone }),
            },
        user.uid,
      );
      setModal("");
      setToast("Saved to your workspace");
      setTimeout(() => setToast(""), 2400);
    } catch {
      setToast("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const saveTimezone = async (
    timezone: string,
    source: "detected" | "manual",
  ) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "users", user.uid), {
        timezone,
        timezoneSource: source,
        timezoneConfirmed: true,
        updatedAt: serverTimestamp(),
      });
      setZone(timezone);
      setTimezoneDraft(timezone);
      setTimezonePrompt(null);
      setToast("Timezone preference saved");
      setTimeout(() => setToast(""), 2400);
    } catch {
      setToast("Could not save your timezone. Try again.");
    }
  };
  const displayName = user?.displayName?.split(" ")[0] || "Founder";
  const todayKey = dateKeyInTimezone(new Date(), zone);
  const todayTasks = tasks
    .filter((task) => {
      const due = dueInstant(task);
      return (
        task.status !== "Completed" &&
        due !== null &&
        dateKeyInTimezone(due, zone) <= todayKey
      );
    })
    .sort((first, second) => {
      const firstDue = dueInstant(first)!;
      const secondDue = dueInstant(second)!;
      const dayOrder = dateKeyInTimezone(firstDue, zone).localeCompare(
        dateKeyInTimezone(secondDue, zone),
      );
      if (dayOrder !== 0) return dayOrder;
      const weight: Record<string, number> = {
        Critical: 0,
        High: 1,
        Medium: 2,
        Low: 3,
      };
      return (
        (weight[first.priority] ?? 4) - (weight[second.priority] ?? 4) ||
        firstDue.getTime() - secondDue.getTime()
      );
    });
  const doneCount = tasks.filter((t) => t.status === "Completed").length;
  const completion = tasks.length
    ? Math.round((100 * doneCount) / tasks.length)
    : 0;
  const weeklyDays = previousSevenDayKeys(zone).map((day) => ({
    ...day,
    count: activity.filter(
      (event) =>
        event.title === "Completed a task" &&
        event.createdAt?.toDate &&
        dateKeyInTimezone(event.createdAt.toDate(), zone) === day.key,
    ).length,
  }));
  const maxDailyCompletions = Math.max(
    1,
    ...weeklyDays.map((day) => day.count),
  );

  if (!user)
    return (
      <main className="login-shell">
        <div className="login-art">
          <div className="art-top">
            <div className="brand-mark">
              <Command size={18} />
            </div>
            <span>FounderOS</span>
            <span className="art-caption">THE FOUNDERS’ OPERATING SYSTEM</span>
          </div>
          <div className="art-copy">
            <div className="eyebrow">
              <Sparkles size={13} /> BUILT FOR THE WORK THAT MATTERS
            </div>
            <h1>
              Make the
              <br />
              <em>important</em>
              <br />
              happen.
            </h1>
            <p>
              Your commitments, team priorities, and progress in one calm place.
            </p>
            <div className="art-card">
              <div className="art-card-top">
                <span>THIS WEEK</span>
                <span className="live-dot"> LIVE</span>
              </div>
              <div className="art-stat">
                <strong>8</strong>
                <span>commitments kept</span>
                <div className="avatar-stack">
                  <i>K</i>
                  <i>R</i>
                </div>
              </div>
              <div className="mini-bars">
                <b />
                <b />
                <b />
                <b />
                <b />
                <b />
                <b />
              </div>
              <div className="art-card-foot">
                <span>Team momentum</span>
                <span>↑ 12% this week</span>
              </div>
            </div>
          </div>
          <div className="art-foot">
            <span>CLARITY · COMMITMENT · MOMENTUM</span>
            <span>01 — 03</span>
          </div>
        </div>
        <section className="login-panel">
          <div className="login-box">
            <div className="login-logo">
              <div className="brand-mark">
                <Command size={17} />
              </div>
              <span>FounderOS</span>
            </div>
            <div className="login-heading">
              <p className="eyebrow">YOUR TEAM, IN SYNC</p>
              <h2>Welcome back.</h2>
              <p>Sign in to pick up where your team left off.</p>
            </div>
            <button
              className="google-button"
              disabled={!firebaseReady}
              onClick={() =>
                signInWithPopup(auth, new GoogleAuthProvider()).catch(() =>
                  setToast("Sign in failed. Check Google sign-in in Firebase."),
                )
              }
            >
              <GoogleIcon /> Continue with Google
            </button>
            {isFirebaseEmulator && (
              <button
                className="demo-button"
                disabled={!firebaseReady}
                onClick={() =>
                  signInAnonymously(auth).catch(() =>
                    setToast(
                      "Start the Firebase Auth emulator, then try again.",
                    ),
                  )
                }
              >
                <ShieldCheck size={16} /> Continue with local demo
              </button>
            )}
            <div className="login-divider">
              <span>PRIVATE BY DESIGN</span>
            </div>
            <div className="secure-note">
              <ShieldCheck size={16} />
              <span>
                Your workspace is private and only accessible to your team.
              </span>
            </div>
            {!firebaseReady && (
              <p className="config-note">
                Firebase is not configured for this environment. Add these
                values to enable sign-in: {firebaseMissing.join(", ")}.
              </p>
            )}
            <div className="login-legal">
              Your workspace is shared only with its members.
            </div>
          </div>
          <div className="login-panel-foot">
            <span>© 2026 FounderOS</span>
            <span>Founder workspace</span>
          </div>
        </section>
        {toast && <div className="toast">{toast}</div>}
      </main>
    );

  const rows =
    section === "Commitments"
      ? commitments
      : section === "Projects"
        ? projects
        : tasks;
  const filteredRows = rows.filter((item) => {
    const matchesSearch = `${item.title || ""} ${item.description || ""}`
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase());
    const matchesStatus =
      statusFilter === "All status" || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const scheduledItems = [...tasks, ...commitments]
    .filter((item) => dueInstant(item) && item.status !== "Completed")
    .sort((a, b) => dueInstant(a)!.getTime() - dueInstant(b)!.getTime());
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "show" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Command size={17} />
          </div>
          <span>FounderOS</span>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            <X size={17} />
          </button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-icon">
            {(profile?.displayName || displayName).slice(0, 1).toUpperCase()}
          </div>
          <div>
            <b>
              {profile?.displayName
                ? `${profile.displayName}'s workspace`
                : `${displayName}’s workspace`}
            </b>
            <small>Founder workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="sidebar-scroll">
          {nav.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.name}
                  className={`nav-item ${section === item.name ? "active" : ""}`}
                  onClick={() => {
                    setSection(item.name);
                    setMobileNav(false);
                  }}
                >
                  <item.icon size={17} />
                  <span>{item.name}</span>
                  {item.name === "My tasks" && todayTasks.length > 0 && (
                    <small className="nav-count">{todayTasks.length}</small>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div className="upgrade-icon">
              <Sparkles size={16} />
            </div>
            <b>Built for founders</b>
            <p>A little more clarity, every day.</p>
            <button onClick={() => open("task")}>
              Add your first task <ArrowRight size={13} />
            </button>
          </div>
          <button className="user-profile" onClick={() => signOut(auth)}>
            <div className="profile-avatar">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <span>
              <b>{user.displayName || "Demo Founder"}</b>
              <small>
                {user.isAnonymous ? "Local demo account" : user.email}
              </small>
            </span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" onClick={() => setMobileNav(true)}>
              <Menu size={19} />
            </button>
            <span className="breadcrumbs">
              Workspace <b>/</b> {section}
            </span>
          </div>
          <div className="topbar-right">
            <span className="timezone">
              <Clock3 size={14} />
              {zone.replace("_", " ")}
            </span>
            <button
              className="icon-button"
              aria-label="Open activity history"
              title="Activity history"
              onClick={() => setSection("Activity")}
            >
              <Activity size={17} />
            </button>
            <button className="help-button" onClick={() => setSection("Help")}>
              <CircleHelp size={16} />
              <span>Help</span>
            </button>
            <div className="profile-avatar small-avatar">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="date-line">
                {formatDateInTimezone(new Date(), zone)} <span>·</span> {zone}
              </div>
              <h1>
                {section === "Overview" ? (
                  <>
                    Good morning, {displayName}
                    <span className="wave">✳</span>
                  </>
                ) : (
                  section
                )}
              </h1>
              <p>
                {section === "Overview"
                  ? "Here’s what’s moving in your workspace today."
                  : section === "My tasks"
                    ? "Your work, priorities, and the next thing to move forward."
                    : `Keep your team's ${section.toLowerCase()} clear and moving forward.`}
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() =>
                open(
                  section === "Commitments"
                    ? "commitment"
                    : section === "Projects"
                      ? "project"
                      : "task",
                )
              }
            >
              <Plus size={16} /> Add{" "}
              {section === "Commitments"
                ? "commitment"
                : section === "Projects"
                  ? "project"
                  : "task"}
            </button>
          </div>
          {timezonePrompt && (
            <div className="timezone-prompt">
              <div>
                <b>
                  {timezonePrompt.previous === timezonePrompt.detected
                    ? "Confirm your timezone"
                    : "Your detected timezone changed"}
                </b>
                <p>
                  Saved: {timezonePrompt.previous} · Detected:{" "}
                  {timezonePrompt.detected}
                </p>
              </div>
              <button
                className="secondary-button"
                onClick={() => saveTimezone(timezonePrompt.previous, "manual")}
              >
                Keep saved
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  saveTimezone(timezonePrompt.detected, "detected")
                }
              >
                Use detected
              </button>
            </div>
          )}
          {section === "Overview" ? (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-top">
                    <span>OPEN TASKS</span>
                    <ListTodo size={16} />
                  </div>
                  <div className="stat-value">
                    {tasks.filter((t) => t.status !== "Completed").length}
                    <span className="stat-context">across your workspace</span>
                  </div>
                  <div className="stat-foot">
                    <span className="stat-dot blue" />
                    {todayTasks.length} need attention today
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-top">
                    <span>ACTIVE COMMITMENTS</span>
                    <Target size={16} />
                  </div>
                  <div className="stat-value">
                    {commitments.filter((c) => c.status !== "Completed").length}
                    <span className="stat-context">promises in motion</span>
                  </div>
                  <div className="stat-foot">
                    <span className="stat-dot violet" />
                    {
                      commitments.filter(
                        (c) =>
                          dueInstant(c) &&
                          dateKeyInTimezone(dueInstant(c)!, zone) <= todayKey &&
                          c.status !== "Completed",
                      ).length
                    }{" "}
                    due or overdue
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-top">
                    <span>PROJECTS</span>
                    <FolderKanban size={16} />
                  </div>
                  <div className="stat-value">
                    {projects.length}
                    <span className="stat-context">shared initiatives</span>
                  </div>
                  <div className="stat-foot">
                    <span className="stat-dot green" />
                    {projects.filter((p) => p.status === "Active").length} in
                    progress
                  </div>
                </div>
                <div className="stat-card progress-stat">
                  <div className="stat-top">
                    <span>WEEKLY MOMENTUM</span>
                    <Gauge size={16} />
                  </div>
                  <div className="progress-value">
                    {completion}
                    <span>%</span>
                    <div className="progress-ring">
                      <Check size={18} />
                    </div>
                  </div>
                  <div className="progress-track">
                    <i style={{ width: `${completion}%` }} />
                  </div>
                  <div className="stat-foot">
                    {doneCount} of {tasks.length} tasks complete
                  </div>
                </div>
              </div>
              <div className="content-grid">
                <section className="panel task-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">MAKE TODAY COUNT</div>
                      <h2>
                        Priority tasks{" "}
                        <span className="pill-count">{todayTasks.length}</span>
                      </h2>
                    </div>
                    <button
                      className="text-action"
                      onClick={() => setSection("My tasks")}
                    >
                      View all <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="task-list">
                    {todayTasks.slice(0, 5).map((t) => (
                      <TaskRow
                        key={t.id}
                        item={t}
                        timezone={zone}
                        onNext={async () => {
                          const next =
                            statuses[
                              (statuses.indexOf(t.status) + 1) % statuses.length
                            ];
                          await changeTask(
                            teamId,
                            t.id,
                            {
                              status: next,
                              previousStatus: t.status,
                              title: t.title,
                            },
                            user.uid,
                          );
                        }}
                      />
                    ))}
                    {!todayTasks.length && (
                      <Empty
                        title="Clear runway."
                        text="No tasks need attention today. Add a task when you’re ready."
                        action={() => open("task")}
                      />
                    )}
                  </div>
                  <button className="add-inline" onClick={() => open("task")}>
                    <Plus size={15} /> Add a task
                  </button>
                </section>
                <section className="panel momentum-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">7-DAY COMPLETIONS</div>
                      <h2>Team momentum</h2>
                    </div>
                    <span className="period-select">Last 7 days</span>
                  </div>
                  <div className="momentum-score">
                    <div>
                      <span>COMPLETION RATE</span>
                      <strong>{completion}%</strong>
                    </div>
                    <span className="trend-badge">
                      <Check size={13} />
                      {weeklyDays.reduce((sum, day) => sum + day.count, 0)}{" "}
                      completed
                    </span>
                  </div>
                  <div className="week-chart">
                    {weeklyDays.map((day, index) => (
                      <div className="chart-col" key={day.key}>
                        <span
                          title={`${day.count} tasks completed`}
                          style={{
                            height: `${day.count ? Math.max(8, (day.count / maxDailyCompletions) * 90) : 4}%`,
                          }}
                          className={
                            index === weeklyDays.length - 1 ? "today-bar" : ""
                          }
                        />
                        <small>{day.label}</small>
                      </div>
                    ))}
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i /> Tasks completed
                    </span>
                    <span>Completion events</span>
                  </div>
                  <div className="momentum-note">
                    <div className="note-icon">
                      <Sparkles size={15} />
                    </div>
                    <span>
                      <b>Start with a clear commitment.</b>
                      <br />
                      Small, visible wins create momentum for the whole team.
                    </span>
                  </div>
                </section>
                <section className="panel commitment-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">SAY IT. OWN IT.</div>
                      <h2>Commitments</h2>
                    </div>
                    <button
                      className="text-action"
                      onClick={() => setSection("Commitments")}
                    >
                      See all <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="commit-list">
                    {commitments.slice(0, 3).map((c) => (
                      <div className="commit-row" key={c.id}>
                        <div className="commit-check">
                          <Target size={15} />
                        </div>
                        <div className="commit-copy">
                          <b>{c.description}</b>
                          <small>
                            {`Due ${formatDue(c, zone)}`} ·{" "}
                            {c.status || "Active"}
                          </small>
                        </div>
                        <span
                          className={`priority-label ${(c.priority || "Medium").toLowerCase()}`}
                        >
                          {c.priority || "Medium"}
                        </span>
                      </div>
                    ))}
                    {!commitments.length && (
                      <Empty
                        title="No promises on the board."
                        text="Write down what you’re committing to."
                        action={() => open("commitment")}
                      />
                    )}
                  </div>
                </section>
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">A LIVING RECORD</div>
                      <h2>Recent activity</h2>
                    </div>
                    <button
                      className="text-action"
                      onClick={() => setSection("Activity")}
                    >
                      Activity log <ArrowRight size={14} />
                    </button>
                  </div>
                  {activity.slice(0, 4).map((a, i) => (
                    <div className="activity-row" key={a.id}>
                      <div className={`activity-avatar tone-${i % 3}`}>
                        {(a.actor || displayName).slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p>
                          <b>
                            {a.actor === user.uid
                              ? "You"
                              : a.actor || "A teammate"}
                          </b>{" "}
                          {a.title?.toLowerCase() || "updated workspace"}
                        </p>
                        <small>
                          {a.createdAt?.toDate
                            ? new Intl.DateTimeFormat("en", {
                                timeZone: zone,
                                hour: "numeric",
                                minute: "2-digit",
                              }).format(a.createdAt.toDate())
                            : "Just now"}
                        </small>
                      </div>
                    </div>
                  ))}
                  {!activity.length && (
                    <Empty
                      title="Your story starts here."
                      text="Tasks and commitments will show up here as they change."
                    />
                  )}
                </section>
              </div>
            </>
          ) : section === "Help" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">QUICK GUIDE</div>
              <h2>Use FounderOS to make work visible.</h2>
              <div className="settings-line">
                <div>
                  <b>Tasks</b>
                  <small>
                    Create work with an owner, priority, and local deadline.
                    Advance its status from the task list.
                  </small>
                </div>
              </div>
              <div className="settings-line">
                <div>
                  <b>Commitments</b>
                  <small>
                    Record a promise separately from the work used to deliver
                    it.
                  </small>
                </div>
              </div>
              <div className="settings-line">
                <div>
                  <b>Timezones</b>
                  <small>
                    Deadlines are stored as UTC instants and shown in your
                    selected IANA timezone.
                  </small>
                </div>
              </div>
              <div className="settings-line">
                <div>
                  <b>History</b>
                  <small>
                    Task creation and status changes are recorded in the
                    workspace activity history.
                  </small>
                </div>
              </div>
            </div>
          ) : section === "Team" ? (
            <div className="panel simple-panel">
              <div className="panel-heading">
                <div>
                  <div className="panel-kicker">YOUR PEOPLE</div>
                  <h2>Team members</h2>
                </div>
                <span className="secure-chip">Invitations are not enabled</span>
              </div>
              <div className="member-row">
                <div className="profile-avatar">
                  {displayName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <b>{user.displayName || "Demo Founder"}</b>
                  <small>{user.email || "Local demo account"} · Owner</small>
                </div>
                <span className="secure-chip">Workspace owner</span>
              </div>
            </div>
          ) : section === "Settings" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">YOUR PREFERENCES</div>
              <h2>Workspace settings</h2>
              <div className="settings-line">
                <div>
                  <b>Local timezone</b>
                  <small>Times in your workspace use this IANA timezone.</small>
                </div>
                <div className="timezone-setting-control">
                  <select
                    className="timezone-chip"
                    value={timezoneDraft}
                    onChange={(event) => setTimezoneDraft(event.target.value)}
                  >
                    {[...new Set([timezoneDraft, ...timezoneOptions])].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                  <button
                    className="secondary-button"
                    disabled={timezoneDraft === zone}
                    onClick={() => saveTimezone(timezoneDraft, "manual")}
                  >
                    Save timezone
                  </button>
                </div>
              </div>
              <div className="settings-line">
                <div>
                  <b>Sign-in method</b>
                  <small>
                    {user.isAnonymous ? "Local demo account" : "Google sign-in"}
                  </small>
                </div>
                <span className="secure-chip">
                  <ShieldCheck size={14} /> Secure
                </span>
              </div>
              <button
                className="secondary-button"
                onClick={() => signOut(auth)}
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          ) : section === "Calendar" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">UPCOMING DEADLINES</div>
              <h2>Your work in local time</h2>
              {scheduledItems.map((item) => (
                <div className="settings-line" key={item.id}>
                  <div>
                    <b>{item.title || item.description}</b>
                    <small>
                      {item.description && item.title
                        ? item.description
                        : item.status}
                    </small>
                  </div>
                  <span className="timezone-chip">{formatDue(item, zone)}</span>
                </div>
              ))}
              {!scheduledItems.length && (
                <Empty
                  title="Nothing scheduled yet."
                  text="Add a task or commitment with a due time to see it here."
                  action={() => open("task")}
                />
              )}
            </div>
          ) : section === "Activity" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">WHAT CHANGED</div>
              <h2>Activity history</h2>
              {activity.map((a, i) => (
                <div className="activity-row large" key={a.id}>
                  <div className={`activity-avatar tone-${i % 3}`}>
                    {(a.actor || displayName).slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p>
                      <b>
                        {a.actor === user.uid ? "You" : a.actor || "A teammate"}
                      </b>{" "}
                      {a.title?.toLowerCase() || "updated workspace"}
                    </p>
                    <small>
                      {a.createdAt?.toDate
                        ? new Intl.DateTimeFormat("en", {
                            timeZone: zone,
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(a.createdAt.toDate())
                        : "Just now"}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="panel full-list">
              <div className="list-toolbar">
                <div className="searchbox">
                  <Search size={15} />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={`Search ${section.toLowerCase()}…`}
                  />
                </div>
                <select
                  className="filter-button"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Filter by status"
                >
                  {[
                    "All status",
                    "Planned",
                    "In Progress",
                    "Blocked",
                    "Completed",
                    "Active",
                    "On Hold",
                    "Missed",
                    "Cancelled",
                  ].map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </div>
              {filteredRows.map((item: any) => (
                <div className="full-row" key={item.id}>
                  <div
                    className="check-circle"
                    onClick={
                      section === "My tasks"
                        ? () =>
                            changeTask(
                              teamId,
                              item.id,
                              {
                                status:
                                  item.status === "Completed"
                                    ? "Planned"
                                    : "Completed",
                                previousStatus: item.status,
                                title: item.title,
                              },
                              user.uid,
                            )
                        : undefined
                    }
                  >
                    {item.status === "Completed" ? <Check size={13} /> : null}
                  </div>
                  <div className="full-row-copy">
                    <b>{item.title || item.description}</b>
                    <small>
                      {item.description && item.title
                        ? item.description
                        : section === "Commitments"
                          ? "Founder commitment"
                          : section === "Projects"
                            ? item.description || "Project"
                            : `Assigned to ${item.ownerUid === user.uid ? "you" : "team"}`}
                    </small>
                  </div>
                  {dueInstant(item) && (
                    <span className="due-label">
                      <CalendarDays size={13} />
                      {formatDue(item, zone)}
                    </span>
                  )}
                  <span
                    className={`status-chip ${(item.status || "active").toLowerCase().replace(" ", "-")}`}
                  >
                    {item.status || "Active"}
                  </span>
                </div>
              ))}
              {!filteredRows.length && (
                <Empty
                  title={
                    rows.length
                      ? "No matching records."
                      : `Nothing in ${section.toLowerCase()} yet.`
                  }
                  text={
                    rows.length
                      ? "Change the search or status filter."
                      : "Make the next commitment visible to your team."
                  }
                  action={
                    rows.length
                      ? undefined
                      : () =>
                          open(
                            section === "Commitments"
                              ? "commitment"
                              : section === "Projects"
                                ? "project"
                                : "task",
                          )
                  }
                />
              )}
            </div>
          )}
          <footer className="page-footer">
            <span>
              <span className="footer-dot" /> Task history enabled
            </span>
            <span>Your team’s work, in one place.</span>
          </footer>
        </div>
      </main>
      {mobileNav && (
        <div className="scrim" onClick={() => setMobileNav(false)} />
      )}{" "}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal("")}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <div>
                <div className="panel-kicker">MAKE IT REAL</div>
                <h2>New {modal}</h2>
              </div>
              <button className="icon-button" onClick={() => setModal("")}>
                <X size={17} />
              </button>
            </div>
            <label>
              {modal === "commitment"
                ? "What are you committing to?"
                : "What needs to get done?"}
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  modal === "commitment" ? "I will…" : "Give it a clear name"
                }
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </label>
            <label>
              Due date and time ({zone}){" "}
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                required={modal !== "project"}
              />
            </label>
            {modal !== "project" && (
              <label>
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {["Low", "Medium", "High", "Critical"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setModal("")}>
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={
                  !title.trim() || busy || (modal !== "project" && !due)
                }
                onClick={create}
              >
                {busy ? (
                  "Saving…"
                ) : (
                  <>
                    Save {modal} <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
function TaskRow({
  item,
  timezone,
  onNext,
}: {
  item: Item;
  timezone: string;
  onNext: () => void;
}) {
  return (
    <div className="task-row">
      <button
        className="task-check"
        onClick={onNext}
        aria-label={`Advance ${item.title} status`}
      >
        {item.status === "Completed" ? <Check size={14} /> : null}
      </button>
      <div className="task-row-copy">
        <b>{item.title}</b>
        <small>
          <span
            className={`priority-dot ${(item.priority || "Medium").toLowerCase()}`}
          />
          {item.priority || "Medium"}
          <span>·</span>
          {`Due ${formatDue(item, timezone)}`}
        </small>
      </div>
      <span
        className={`status-chip ${(item.status || "planned").toLowerCase().replace(" ", "-")}`}
      >
        {item.status || "Planned"}
      </span>
      <button className="row-menu" onClick={onNext} aria-label="Update status">
        <ChevronDown size={15} />
      </button>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <CheckCheck size={18} />
      </div>
      <b>{title}</b>
      <p>{text}</p>
      {action && (
        <button onClick={action}>
          Add one <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}
function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"
      />
      <path
        fill="#34A853"
        d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z"
      />
      <path
        fill="#FBBC05"
        d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z"
      />
      <path
        fill="#EA4335"
        d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6.1 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z"
      />
    </svg>
  );
}
