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
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
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
  Send,
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
  acceptInvitation,
  addTaskComment,
  createInvitation,
  type TeamRole,
} from "@/lib/data";
import { scheduleGoogleMeeting } from "@/lib/google-calendar";
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
      { name: "Team tasks", icon: Users },
      { name: "Commitments", icon: Target },
      { name: "Projects", icon: FolderKanban },
      { name: "Calendar", icon: CalendarDays },
      { name: "Meetings", icon: CalendarDays },
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
  const [members, setMembers] = useState<Item[]>([]);
  const [workspaces, setWorkspaces] = useState<Item[]>([]);
  const [invitations, setInvitations] = useState<Item[]>([]);
  const [memberRole, setMemberRole] = useState<TeamRole>("Member");
  const [teamName, setTeamName] = useState("");
  const [pendingInvite, setPendingInvite] = useState<{
    teamId: string;
    token: string;
  } | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<Exclude<TeamRole, "Owner">>("Member");
  const [inviteLink, setInviteLink] = useState("");
  const [selectedTask, setSelectedTask] = useState<Item | null>(null);
  const [taskComments, setTaskComments] = useState<Item[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Item | null>(null);
  const [description, setDescription] = useState("");
  const [attendeeEmails, setAttendeeEmails] = useState("");
  const [meetingStart, setMeetingStart] = useState("");
  const [meetingEnd, setMeetingEnd] = useState("");
  const inviteAttempt = useRef("");
  const revocationHandled = useRef("");
  const [section, setSection] = useState("Overview"),
    [tasks, setTasks] = useState<Item[]>([]),
    [commitments, setCommitments] = useState<Item[]>([]),
    [projects, setProjects] = useState<Item[]>([]),
    [activity, setActivity] = useState<Item[]>([]);
  const [modal, setModal] = useState(""),
    [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState("Medium"),
    [taskOwnerUid, setTaskOwnerUid] = useState(""),
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
    const params = new URLSearchParams(window.location.search);
    const invitedTeam = params.get("team");
    const inviteToken = params.get("invite");
    if (invitedTeam && inviteToken) {
      setPendingInvite({ teamId: invitedTeam, token: inviteToken });
    }
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
      setMembers([]);
      setInvitations([]);
      inviteAttempt.current = "";
      checkedTimezoneUid.current = "";
      setTimezonePrompt(null);
      return;
    }
    let live = true;
    const timezone = zone;
    if (pendingInvite) {
      const attempt = `${user.uid}:${pendingInvite.teamId}:${pendingInvite.token}`;
      if (inviteAttempt.current === attempt) return;
      inviteAttempt.current = attempt;
      acceptInvitation(
        pendingInvite.teamId,
        pendingInvite.token,
        {
          uid: user.uid,
          email: user.email || "",
          displayName: user.displayName || "",
          photoURL: user.photoURL,
        },
        timezone,
      )
        .then(() => {
          if (auth.currentUser?.uid !== user.uid) return;
          setInviteError("");
          setTeamId(pendingInvite.teamId);
          setPendingInvite(null);
          window.history.replaceState({}, "", window.location.pathname);
          setToast("You joined the team workspace");
        })
        .catch((error: unknown) => {
          if (auth.currentUser?.uid !== user.uid) return;
          setInviteError(
            error instanceof Error
              ? error.message
              : "Could not accept this invitation.",
          );
        });
      return () => {
        live = false;
      };
    }
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
  }, [user, zone, pendingInvite]);
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
  useEffect(() => {
    if (!teamId || !user) return;
    const unsubscribeMembers = onSnapshot(
      query(
        collection(db, "teams", teamId, "members"),
        orderBy("joinedAt", "asc"),
      ),
      (snapshot) => {
        const nextMembers = snapshot.docs.map(
          (entry) => ({ id: entry.id, ...entry.data() }) as Item,
        );
        setMembers(nextMembers);
        setMemberRole(
          (nextMembers.find((member) => member.id === user.uid)?.role ||
            "Member") as TeamRole,
        );
      },
    );
    const unsubscribeTeam = onSnapshot(doc(db, "teams", teamId), (snapshot) => {
      setTeamName(snapshot.data()?.name || "Founder workspace");
    });
    return () => {
      unsubscribeMembers();
      unsubscribeTeam();
    };
  }, [teamId, user]);
  useEffect(() => {
    if (!user || !profile) return;
    const ids = Array.from(
      new Set<string>([
        ...(Array.isArray(profile.teamIds) ? profile.teamIds : []),
        ...(profile.teamId ? [profile.teamId] : []),
      ]),
    );
    let active = true;
    Promise.all(
      ids.map(async (id) => {
        try {
          const snapshot = await getDoc(doc(db, "teams", id));
          return snapshot.exists()
            ? ({
                id,
                name: snapshot.data().name || "Founder workspace",
              } as Item)
            : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (active)
        setWorkspaces(results.filter((entry): entry is Item => entry !== null));
    });
    return () => {
      active = false;
    };
  }, [user, profile]);
  useEffect(() => {
    if (!teamId || !user) return;
    let active = true;
    const unsubscribe = onSnapshot(
      doc(db, "teams", teamId, "members", user.uid),
      () => {
        revocationHandled.current = "";
      },
      async (error) => {
        if (error.code !== "permission-denied" || !active) {
          setToast("Could not verify team membership. Check your connection.");
          return;
        }
        if (revocationHandled.current === `${user.uid}:${teamId}`) return;
        revocationHandled.current = `${user.uid}:${teamId}`;
        const alternate = workspaces.find(
          (workspace) => workspace.id !== teamId,
        );
        try {
          if (alternate) {
            await updateDoc(doc(db, "users", user.uid), {
              teamId: alternate.id,
              updatedAt: serverTimestamp(),
            });
            if (active) {
              setTeamId(alternate.id);
              setToast("Your access changed. Switched to another workspace.");
            }
          } else {
            await updateDoc(doc(db, "users", user.uid), {
              teamId: "",
              teamIds: workspaces
                .map((workspace) => workspace.id)
                .filter((id) => id !== teamId),
              updatedAt: serverTimestamp(),
            });
            const nextTeamId = await ensureWorkspace(user.uid, {
              displayName: user.displayName || "Founder",
              email: user.email || "founder@founderos.local",
              photoURL: user.photoURL,
              timezone: zone,
            });
            if (active) {
              setTeamId(nextTeamId);
              setToast(
                "Your previous access ended. A private workspace is ready.",
              );
            }
          }
        } catch {
          if (active)
            setToast("Your team access changed. Sign out and sign in again.");
        }
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [teamId, user, workspaces, zone]);
  const canManageTeam = memberRole === "Owner" || memberRole === "Admin";
  useEffect(() => {
    if (!teamId || !canManageTeam) {
      setInvitations([]);
      return;
    }
    return onSnapshot(
      query(
        collection(db, "teams", teamId, "invites"),
        orderBy("createdAt", "desc"),
      ),
      (snapshot) =>
        setInvitations(
          snapshot.docs.map(
            (entry) => ({ id: entry.id, ...entry.data() }) as Item,
          ),
        ),
    );
  }, [teamId, canManageTeam]);
  useEffect(() => {
    if (!teamId || !selectedTask) {
      setTaskComments([]);
      return;
    }
    return onSnapshot(
      query(
        collection(db, "teams", teamId, "tasks", selectedTask.id, "comments"),
        orderBy("createdAt", "desc"),
        limit(100),
      ),
      (snapshot) =>
        setTaskComments(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }) as Item)
            .reverse(),
        ),
    );
  }, [teamId, selectedTask]);
  const open = (kind: string) => {
    if (memberRole === "Viewer") {
      setToast("Viewer access is read-only.");
      return;
    }
    if (kind === "project" && !canManageTeam) {
      setToast("Only Owners and Admins can manage projects.");
      return;
    }
    setTitle("");
    setDue("");
    setPriority("Medium");
    setDescription("");
    setTaskOwnerUid(user?.uid || "");
    setModal(kind);
  };
  const dismissInvite = () => {
    setPendingInvite(null);
    setInviteError("");
    inviteAttempt.current = "";
    window.history.replaceState({}, "", window.location.pathname);
  };
  const switchWorkspace = async (nextTeamId: string) => {
    if (!user || !nextTeamId || nextTeamId === teamId) return;
    try {
      await updateDoc(doc(db, "users", user.uid), {
        teamId: nextTeamId,
        updatedAt: serverTimestamp(),
      });
      setTeamId(nextTeamId);
      setInviteLink("");
      setSection("Overview");
      setToast("Workspace switched");
    } catch {
      setToast("Could not switch workspace. Membership may have changed.");
    }
  };
  const inviteTeammate = async () => {
    if (!user || !teamId || !inviteEmail.trim()) return;
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (
      members.some((member) => member.email?.toLowerCase() === normalizedEmail)
    ) {
      setToast("That person is already a team member.");
      return;
    }
    if (
      invitations.some(
        (invite) =>
          invite.email === normalizedEmail &&
          invite.status === "pending" &&
          invite.expiresAt?.toMillis?.() > Date.now(),
      )
    ) {
      setToast(
        "There is already a pending invite for that email. Revoke it before creating another.",
      );
      return;
    }
    setBusy(true);
    try {
      const token = await createInvitation(
        teamId,
        inviteEmail,
        inviteRole,
        user.uid,
      );
      const url = new URL(window.location.origin);
      url.searchParams.set("team", teamId);
      url.searchParams.set("invite", token);
      setInviteLink(url.toString());
      setInviteEmail("");
      setToast("Invitation link created · valid for 7 days");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Could not create invitation.",
      );
    } finally {
      setBusy(false);
    }
  };
  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setToast("Invitation link copied");
    } catch {
      setToast("Copy failed. Select and copy the invitation link.");
    }
  };
  const changeMemberRole = async (member: Item, role: TeamRole) => {
    if (!teamId || !user) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "teams", teamId, "members", member.id), { role });
      batch.set(doc(collection(db, "teams", teamId, "activity")), {
        type: "team_role_changed",
        title: "Updated a team role",
        detail: `${member.displayName || member.email}: ${member.role} → ${role}`,
        actor: user.uid,
        entityId: member.id,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setToast(`${member.displayName || member.email} is now ${role}`);
    } catch {
      setToast("You do not have permission to change this role.");
    }
  };
  const removeMember = async (member: Item) => {
    if (
      !teamId ||
      !user ||
      !window.confirm(
        `Remove ${member.displayName || member.email} from this workspace?`,
      )
    )
      return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "teams", teamId, "members", member.id));
      batch.set(doc(collection(db, "teams", teamId, "activity")), {
        type: "team_member_removed",
        title: "Removed a team member",
        detail: member.displayName || "A team member",
        actor: user.uid,
        entityId: member.id,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setToast("Team member removed");
    } catch {
      setToast("You do not have permission to remove this member.");
    }
  };
  const revokeInvitation = async (invite: Item) => {
    if (!teamId || !user) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "teams", teamId, "invites", invite.id), {
        status: "revoked",
        revokedBy: user.uid,
        revokedAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, "teams", teamId, "activity")), {
        type: "team_invitation_revoked",
        title: "Revoked a team invitation",
        actor: user.uid,
        entityId: "team",
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      if (inviteLink.includes(encodeURIComponent(invite.id))) setInviteLink("");
      setToast("Invitation revoked");
    } catch {
      setToast("You do not have permission to revoke this invitation.");
    }
  };
  const postTaskComment = async () => {
    if (!user || !teamId || !selectedTask || !commentDraft.trim()) return;
    setBusy(true);
    try {
      await addTaskComment(
        teamId,
        selectedTask.id,
        {
          uid: user.uid,
          name: user.displayName || user.email || "Teammate",
          email: user.email || "",
        },
        commentDraft,
        replyTo?.id,
      );
      setCommentDraft("");
      setReplyTo(null);
    } catch {
      setToast("Could not post this discussion. Check your team role.");
    } finally {
      setBusy(false);
    }
  };
  const saveTaskDescription = async () => {
    if (!teamId || !selectedTask || !user) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "teams", teamId, "tasks", selectedTask.id), {
        description: description.trim(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, "teams", teamId, "activity")), {
        type: "task_details_updated",
        title: "Updated task details",
        detail: selectedTask.title,
        actor: user.uid,
        entityId: selectedTask.id,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setSelectedTask({ ...selectedTask, description: description.trim() });
      setToast("Task details saved");
    } catch {
      setToast("Could not save task details.");
    } finally {
      setBusy(false);
    }
  };
  const createMeeting = async () => {
    if (!teamId || !selectedTask || !meetingStart || !meetingEnd || !user)
      return;
    setBusy(true);
    try {
      const meeting = await scheduleGoogleMeeting({
        title: `FounderOS · ${selectedTask.title}`,
        description: selectedTask.description || selectedTask.title,
        start: toUtcInstant(meetingStart, zone),
        end: toUtcInstant(meetingEnd, zone),
        timezone: zone,
        attendeeEmails: attendeeEmails
          .split(/[\s,;]+/)
          .map((email) => email.trim())
          .filter(Boolean),
      });
      const batch = writeBatch(db);
      batch.update(doc(db, "teams", teamId, "tasks", selectedTask.id), {
        googleCalendarEventId: meeting.eventId,
        meetingUrl: meeting.meetUrl,
        calendarEventUrl: meeting.htmlLink || "",
        meetingStart: toUtcInstant(meetingStart, zone),
        meetingEnd: toUtcInstant(meetingEnd, zone),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, "teams", teamId, "activity")), {
        type: "meeting_scheduled",
        title: "Scheduled a Google Calendar meeting",
        detail: selectedTask.title,
        actor: user.uid,
        entityId: selectedTask.id,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setSelectedTask({
        ...selectedTask,
        meetingUrl: meeting.meetUrl,
        calendarEventUrl: meeting.htmlLink || "",
        googleCalendarEventId: meeting.eventId,
      });
      setToast(
        meeting.meetUrl
          ? "Google Calendar meeting scheduled"
          : "Calendar event scheduled; Meet link is still being prepared",
      );
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Could not schedule the meeting.",
      );
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (memberRole === "Viewer") return;
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
              ownerUid: taskOwnerUid || user.uid,
              dueAt: toUtcInstant(due, zone),
              timezone: zone,
            }
          : {
              title: title.trim(),
              ...(description.trim()
                ? { description: description.trim() }
                : {}),
              status: modal === "project" ? "Active" : "Planned",
              ...(modal === "project"
                ? {}
                : {
                    priority,
                    ownerUid: taskOwnerUid || user.uid,
                    dueAt: toUtcInstant(due, zone),
                    timezone: zone,
                  }),
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

  if (user && inviteError)
    return (
      <main className="login-shell invite-gate">
        <section className="login-panel">
          <div className="login-box">
            <div className="login-logo">
              <div className="brand-mark">
                <Users size={17} />
              </div>
              <span>FounderOS</span>
            </div>
            <div className="login-heading">
              <p className="eyebrow">TEAM INVITATION</p>
              <h2>We couldn’t join this workspace.</h2>
              <p>{inviteError}</p>
            </div>
            <button className="primary-button" onClick={dismissInvite}>
              Create my own workspace <ArrowRight size={14} />
            </button>
            <button className="secondary-button" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  if (user && !teamId)
    return (
      <main className="login-shell invite-gate">
        <section className="login-panel">
          <div className="login-box">
            <div className="login-logo">
              <div className="brand-mark">
                <Command size={17} />
              </div>
              <span>FounderOS</span>
            </div>
            <div className="login-heading">
              <p className="eyebrow">
                {pendingInvite ? "TEAM INVITATION" : "YOUR WORKSPACE"}
              </p>
              <h2>
                {pendingInvite
                  ? "Joining your team…"
                  : "Preparing your workspace…"}
              </h2>
              <p>
                {pendingInvite
                  ? "We’re verifying your invitation and setting up your access."
                  : "Your private workspace is getting ready."}
              </p>
            </div>
            {pendingInvite && (
              <button className="secondary-button" onClick={dismissInvite}>
                Continue without this invite
              </button>
            )}
          </div>
        </section>
      </main>
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
              <h2>{pendingInvite ? "Join your team." : "Welcome back."}</h2>
              <p>
                {pendingInvite
                  ? "Sign in with the email address this invitation was sent to."
                  : "Sign in to pick up where your team left off."}
              </p>
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
    section === "My tasks"
      ? tasks.filter((task) => task.ownerUid === user.uid)
      : section === "Team tasks"
        ? tasks
        : section === "Commitments"
          ? commitments
          : section === "Projects"
            ? projects
            : tasks;
  const taskAssignees = canManageTeam
    ? members
    : members.filter((member) => member.id === user.uid);
  const canEditSelectedTask =
    memberRole === "Owner" ||
    memberRole === "Admin" ||
    selectedTask?.ownerUid === user.uid ||
    selectedTask?.createdBy === user.uid;
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
  const scheduledMeetings = tasks
    .filter((task) => task.meetingStart && task.status !== "Cancelled")
    .sort((first, second) => {
      const firstDate = first.meetingStart?.toDate
        ? first.meetingStart.toDate()
        : new Date(first.meetingStart);
      const secondDate = second.meetingStart?.toDate
        ? second.meetingStart.toDate()
        : new Date(second.meetingStart);
      return firstDate.getTime() - secondDate.getTime();
    });
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
          <div className="workspace-switch-copy">
            <select
              className="workspace-select"
              aria-label="Active workspace"
              value={teamId}
              disabled={workspaces.length < 2}
              onChange={(event) => switchWorkspace(event.target.value)}
            >
              {(workspaces.length
                ? workspaces
                : [
                    {
                      id: teamId,
                      name: teamName || `${displayName}’s workspace`,
                    },
                  ]
              ).map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <small>{memberRole} workspace</small>
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
                    : section === "Team"
                      ? "Invite teammates and manage workspace roles."
                      : section === "Meetings"
                        ? "Schedule Google Calendar meetings from the tasks your team is doing."
                        : `Keep ${section.toLowerCase()} clear and moving forward.`}
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
                        readOnly={
                          memberRole === "Viewer" ||
                          (memberRole === "Member" &&
                            t.ownerUid !== user.uid &&
                            t.createdBy !== user.uid)
                        }
                        onNext={async () => {
                          if (
                            memberRole === "Viewer" ||
                            (memberRole === "Member" &&
                              t.ownerUid !== user.uid &&
                              t.createdBy !== user.uid)
                          )
                            return;
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
                  <button
                    className="add-inline"
                    disabled={memberRole === "Viewer"}
                    onClick={() => open("task")}
                  >
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
                <span className="secure-chip">
                  {members.length} {members.length === 1 ? "member" : "members"}
                </span>
              </div>
              {members.map((member) => (
                <div className="member-row" key={member.id}>
                  <div className="profile-avatar">
                    {(member.displayName || member.email || "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </div>
                  <div className="member-copy">
                    <b>
                      {member.displayName || "FounderOS member"}
                      {member.id === user.uid ? " · You" : ""}
                    </b>
                    <small>{member.email}</small>
                  </div>
                  {canManageTeam &&
                  member.id !== user.uid &&
                  member.role !== "Owner" ? (
                    <div className="member-controls">
                      <select
                        aria-label={`Role for ${member.email}`}
                        value={member.role}
                        onChange={(event) =>
                          changeMemberRole(
                            member,
                            event.target.value as TeamRole,
                          )
                        }
                      >
                        {(memberRole === "Owner"
                          ? ["Admin", "Member", "Viewer"]
                          : ["Member", "Viewer"]
                        ).map((role) => (
                          <option key={role}>{role}</option>
                        ))}
                      </select>
                      {(memberRole === "Owner" ||
                        ["Member", "Viewer"].includes(member.role)) && (
                        <button
                          className="text-action danger-action"
                          onClick={() => removeMember(member)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="role-chip">{member.role}</span>
                  )}
                </div>
              ))}
              {canManageTeam ? (
                <div className="invite-panel">
                  <div className="panel-kicker">INVITE BY LINK</div>
                  <p>
                    Links are single-use and expire after 7 days. Share them
                    only with the invited person.
                  </p>
                  <div className="invite-form">
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="teammate@company.com"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                    />
                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(
                          event.target.value as Exclude<TeamRole, "Owner">,
                        )
                      }
                      aria-label="Invited role"
                    >
                      {(memberRole === "Owner"
                        ? ["Admin", "Member", "Viewer"]
                        : ["Member", "Viewer"]
                      ).map((role) => (
                        <option key={role}>{role}</option>
                      ))}
                    </select>
                    <button
                      className="primary-button"
                      disabled={busy || !inviteEmail.trim() || !user.email}
                      onClick={inviteTeammate}
                    >
                      <Send size={14} /> Create link
                    </button>
                  </div>
                  {!user.email && (
                    <small className="form-hint">
                      A verified email account is required to invite teammates.
                    </small>
                  )}
                  {inviteLink && (
                    <div className="invite-link-row">
                      <input
                        readOnly
                        value={inviteLink}
                        aria-label="Invitation link"
                      />
                      <button
                        className="secondary-button"
                        onClick={copyInviteLink}
                      >
                        Copy link
                      </button>
                    </div>
                  )}
                  <div className="invite-list">
                    {invitations
                      .filter((invite) => invite.status === "pending")
                      .map((invite) => (
                        <div className="invite-item" key={invite.id}>
                          <div>
                            <b>{invite.email}</b>
                            <small>
                              {invite.role} · expires{" "}
                              {invite.expiresAt?.toDate
                                ? formatDateInTimezone(
                                    invite.expiresAt.toDate(),
                                    zone,
                                  )
                                : "in 7 days"}
                            </small>
                          </div>
                          <button
                            className="text-action danger-action"
                            onClick={() => revokeInvitation(invite)}
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="invite-panel">
                  <div className="panel-kicker">TEAM PERMISSIONS</div>
                  <p>
                    Your <b>{memberRole}</b> role controls whether you can
                    change workspace content or manage members.
                  </p>
                </div>
              )}
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
              <div className="meeting-calendar-list">
                <div className="panel-kicker">SCHEDULED MEETINGS</div>
                {scheduledMeetings.map((meeting) => (
                  <div className="settings-line" key={meeting.id}>
                    <div>
                      <b>{meeting.title}</b>
                      <small>
                        {formatInstantInTimezone(
                          meeting.meetingStart?.toDate
                            ? meeting.meetingStart.toDate()
                            : new Date(meeting.meetingStart),
                          zone,
                        )}{" "}
                        · task meeting
                      </small>
                    </div>
                    {meeting.meetingUrl ? (
                      <a
                        className="meeting-link"
                        href={meeting.meetingUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Join <ArrowRight size={13} />
                      </a>
                    ) : (
                      meeting.calendarEventUrl && (
                        <a
                          className="meeting-link"
                          href={meeting.calendarEventUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open event <ArrowRight size={13} />
                        </a>
                      )
                    )}
                  </div>
                ))}
                {!scheduledMeetings.length && (
                  <p className="form-hint">
                    No meetings scheduled yet. Open a task to schedule one.
                  </p>
                )}
              </div>
            </div>
          ) : section === "Meetings" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">GOOGLE CALENDAR</div>
              <h2>Team meetings</h2>
              <p className="meetings-intro">
                Google Calendar meetings linked to team tasks, shown in {zone}.
              </p>
              {scheduledMeetings.map((meeting) => (
                <div className="settings-line" key={meeting.id}>
                  <div>
                    <b>{meeting.title}</b>
                    <small>
                      {formatInstantInTimezone(
                        meeting.meetingStart?.toDate
                          ? meeting.meetingStart.toDate()
                          : new Date(meeting.meetingStart),
                        zone,
                      )}{" "}
                      –{" "}
                      {formatInstantInTimezone(
                        meeting.meetingEnd?.toDate
                          ? meeting.meetingEnd.toDate()
                          : new Date(meeting.meetingEnd),
                        zone,
                      )}
                    </small>
                  </div>
                  {meeting.meetingUrl ? (
                    <a
                      className="meeting-link"
                      href={meeting.meetingUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Join Google Meet <ArrowRight size={13} />
                    </a>
                  ) : (
                    meeting.calendarEventUrl && (
                      <a
                        className="meeting-link"
                        href={meeting.calendarEventUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Calendar event <ArrowRight size={13} />
                      </a>
                    )
                  )}
                </div>
              ))}
              {!scheduledMeetings.length && (
                <Empty
                  title="No team meetings yet."
                  text="Open a task to schedule a Google Calendar meeting and invite attendees."
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
                      (section === "My tasks" || section === "Team tasks") &&
                      (canManageTeam ||
                        item.ownerUid === user.uid ||
                        item.createdBy === user.uid)
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
                            : `Assigned to ${members.find((member) => member.id === item.ownerUid)?.displayName || (item.ownerUid === user.uid ? "you" : "team")}`}
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
                  {(section === "My tasks" || section === "Team tasks") && (
                    <button
                      className="text-action task-details-action"
                      onClick={() => {
                        setSelectedTask(item);
                        setDescription(item.description || "");
                        setAttendeeEmails("");
                        setMeetingStart("");
                        setMeetingEnd("");
                        setReplyTo(null);
                        setCommentDraft("");
                      }}
                    >
                      Details
                    </button>
                  )}
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
            {(modal === "task" || modal === "project") && (
              <label>
                Details and context
                <textarea
                  maxLength={5000}
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Add useful context, success criteria, links, or questions…"
                />
              </label>
            )}
            {modal === "task" && (
              <label>
                Task owner
                <select
                  value={taskOwnerUid}
                  onChange={(event) => setTaskOwnerUid(event.target.value)}
                >
                  {taskAssignees.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName || member.email || "Team member"}
                      {member.id === user.uid ? " · You" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
      {selectedTask && (
        <div
          className="modal-backdrop task-detail-backdrop"
          onClick={() => setSelectedTask(null)}
        >
          <section
            className="modal task-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-top">
              <div>
                <div className="panel-kicker">TASK DETAILS</div>
                <h2 id="task-detail-title">{selectedTask.title}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close task details"
                onClick={() => setSelectedTask(null)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="task-detail-scroll">
              <label>
                Description and context
                <textarea
                  rows={5}
                  maxLength={5000}
                  value={description}
                  disabled={!canEditSelectedTask}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Add context, success criteria, links, or questions for your team…"
                />
              </label>
              {!canEditSelectedTask && (
                <small className="form-hint">
                  Only Owners, Admins, the assignee, or the creator can edit
                  task details.
                </small>
              )}
              {canEditSelectedTask && (
                <button
                  className="secondary-button"
                  disabled={
                    busy || description === (selectedTask.description || "")
                  }
                  onClick={saveTaskDescription}
                >
                  Save details
                </button>
              )}
              <section className="meeting-card">
                <div className="panel-kicker">GOOGLE CALENDAR</div>
                <h3>Schedule a team meeting</h3>
                <p>
                  Creates a Calendar event, sends attendee invitations, and
                  requests a Google Meet link.
                </p>
                {selectedTask.meetingUrl && (
                  <a
                    className="meeting-link"
                    href={selectedTask.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Join Google Meet <ArrowRight size={14} />
                  </a>
                )}
                {selectedTask.calendarEventUrl && (
                  <a
                    className="meeting-link"
                    href={selectedTask.calendarEventUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google Calendar <ArrowRight size={14} />
                  </a>
                )}
                {memberRole !== "Viewer" && (
                  <>
                    <div className="meeting-times">
                      <label>
                        Starts ({zone})
                        <input
                          type="datetime-local"
                          value={meetingStart}
                          onChange={(event) =>
                            setMeetingStart(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Ends ({zone})
                        <input
                          type="datetime-local"
                          value={meetingEnd}
                          onChange={(event) =>
                            setMeetingEnd(event.target.value)
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Attendee emails{" "}
                      <input
                        value={attendeeEmails}
                        onChange={(event) =>
                          setAttendeeEmails(event.target.value)
                        }
                        placeholder="name@company.com, teammate@company.com"
                      />
                    </label>
                    <button
                      className="primary-button"
                      disabled={
                        busy ||
                        !meetingStart ||
                        !meetingEnd ||
                        toUtcInstant(meetingEnd, zone) <=
                          toUtcInstant(meetingStart, zone)
                      }
                      onClick={createMeeting}
                    >
                      {busy ? "Scheduling…" : "Connect Google & schedule"}{" "}
                      <ArrowRight size={14} />
                    </button>
                  </>
                )}
              </section>
              <section className="discussion-section">
                <div className="panel-kicker">TASK THREAD</div>
                <h3>Questions and discussion</h3>
                <p>
                  Ask for clarification, share updates, and reply in context.
                </p>
                <div className="thread-list">
                  {taskComments
                    .filter((comment) => !comment.parentId)
                    .map((comment) => (
                      <article className="thread-comment" key={comment.id}>
                        <div className="thread-comment-head">
                          <b>{comment.authorName}</b>
                          <small>
                            {comment.createdAt?.toDate
                              ? formatDateInTimezone(
                                  comment.createdAt.toDate(),
                                  zone,
                                )
                              : "Just now"}
                          </small>
                        </div>
                        <p>{comment.body}</p>
                        {memberRole !== "Viewer" && (
                          <button
                            className="text-action"
                            onClick={() => setReplyTo(comment)}
                          >
                            Reply
                          </button>
                        )}
                        {taskComments
                          .filter((reply) => reply.parentId === comment.id)
                          .map((reply) => (
                            <div className="thread-reply" key={reply.id}>
                              <div className="thread-comment-head">
                                <b>{reply.authorName}</b>
                                <small>
                                  {reply.createdAt?.toDate
                                    ? formatDateInTimezone(
                                        reply.createdAt.toDate(),
                                        zone,
                                      )
                                    : "Just now"}
                                </small>
                              </div>
                              <p>{reply.body}</p>
                            </div>
                          ))}
                      </article>
                    ))}
                  {!taskComments.length && (
                    <div className="thread-empty">
                      No discussion yet. Start the thread with a question or
                      update.
                    </div>
                  )}
                </div>
                {memberRole !== "Viewer" ? (
                  <div className="thread-composer">
                    {replyTo && (
                      <div className="replying-to">
                        Replying to {replyTo.authorName}
                        <button
                          className="text-action"
                          onClick={() => setReplyTo(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <textarea
                      rows={3}
                      maxLength={5000}
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      placeholder={
                        replyTo
                          ? "Write a reply…"
                          : "Ask a question or share an update…"
                      }
                    />
                    <button
                      className="primary-button"
                      disabled={busy || !commentDraft.trim()}
                      onClick={postTaskComment}
                    >
                      {busy ? "Posting…" : "Post to thread"} <Send size={14} />
                    </button>
                  </div>
                ) : (
                  <small className="form-hint">
                    Viewer access is read-only.
                  </small>
                )}
              </section>
            </div>
          </section>
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
  readOnly,
  onNext,
}: {
  item: Item;
  timezone: string;
  readOnly: boolean;
  onNext: () => void;
}) {
  return (
    <div className="task-row">
      <button
        className="task-check"
        onClick={onNext}
        disabled={readOnly}
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
      <button
        className="row-menu"
        disabled={readOnly}
        onClick={onNext}
        aria-label="Update status"
      >
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
