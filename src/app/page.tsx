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
  deleteField,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  ClipboardCheck,
  Command,
  FolderKanban,
  FlagTriangleRight,
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
  storage,
} from "@/lib/firebase";
import { addItem, changeTask, ensureWorkspace, type Item } from "@/lib/data";
import {
  acceptInvitation,
  addTaskComment,
  createInvitation,
  type TeamRole,
} from "@/lib/data";
import {
  requestGoogleCalendarAccess,
  scheduleGoogleMeeting,
} from "@/lib/google-calendar";
import {
  dateKeyInTimezone,
  detectBrowserTimezone,
  formatDateInTimezone,
  formatInstantInTimezone,
  findCommonTimeSlots,
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
      { name: "Availability", icon: CalendarClock },
      { name: "Milestones", icon: FlagTriangleRight },
      { name: "Timeline", icon: Activity },
      { name: "Accountability", icon: BarChart3 },
      { name: "Weekly review", icon: ClipboardCheck },
      { name: "Activity", icon: Activity },
    ],
  },
  {
    label: "Manage",
    items: [
      { name: "Team", icon: Users },
      { name: "Notifications", icon: Bell },
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
function formatMemberTime(date: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return "Timezone unavailable";
  }
}
function getMemberAvailability(member: Item, tasks: Item[], now: Date) {
  if (member.availabilityStatus && member.availabilityStatus !== "Auto") {
    return member.availabilityStatus;
  }
  const activeMeeting = tasks.some((task) => {
    if (task.ownerUid !== member.id || !task.meetingStart || !task.meetingEnd)
      return false;
    const start = task.meetingStart.toDate?.() || new Date(task.meetingStart);
    const end = task.meetingEnd.toDate?.() || new Date(task.meetingEnd);
    return now >= start && now < end;
  });
  if (activeMeeting) return "In meeting";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: member.timezone || "UTC",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const part = (type: string) =>
      parts.find((entry) => entry.type === type)?.value || "";
    const days: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const [startHour, startMinute] = (member.workdayStart || "09:00")
      .split(":")
      .map(Number);
    const [endHour, endMinute] = (member.workdayEnd || "17:00")
      .split(":")
      .map(Number);
    const minute = Number(part("hour")) * 60 + Number(part("minute"));
    const workingDays: number[] = member.workingDays?.length
      ? member.workingDays
      : [1, 2, 3, 4, 5];
    return workingDays.includes(days[part("weekday")]) &&
      minute >= startHour * 60 + startMinute &&
      minute < endHour * 60 + endMinute
      ? "Available"
      : "Outside hours";
  } catch {
    return "Timezone unavailable";
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
  const [company, setCompany] = useState<Item | null>(null);
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [companyDraft, setCompanyDraft] = useState({
    name: "",
    legalName: "",
    website: "",
    industry: "",
    stage: "",
    country: "",
    region: "",
    defaultTimezone: "UTC",
  });
  const [locationDraft, setLocationDraft] = useState({
    country: "",
    region: "",
  });
  const [memberTitleDraft, setMemberTitleDraft] = useState("");
  const [clockNow, setClockNow] = useState(() => new Date());
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
  const [scheduleMeetingOnCreate, setScheduleMeetingOnCreate] = useState(false);
  const [quickNotificationsOpen, setQuickNotificationsOpen] = useState(false);
  const inviteAttempt = useRef("");
  const revocationHandled = useRef("");
  const notificationIds = useRef(new Set<string>());
  const notificationSnapshotUid = useRef("");
  const [section, setSection] = useState("Overview"),
    [tasks, setTasks] = useState<Item[]>([]),
    [commitments, setCommitments] = useState<Item[]>([]),
    [projects, setProjects] = useState<Item[]>([]),
    [activity, setActivity] = useState<Item[]>([]);
  const [milestones, setMilestones] = useState<Item[]>([]);
  const [weeklyReviews, setWeeklyReviews] = useState<Item[]>([]);
  const [notifications, setNotifications] = useState<Item[]>([]);
  const [availabilityDraft, setAvailabilityDraft] = useState({
    status: "Auto",
    workingDays: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "17:00",
  });
  const [reviewDraft, setReviewDraft] = useState({
    weekStart: "",
    wins: "",
    misses: "",
    blockers: "",
    priorities: "",
    reflection: "",
  });
  const [modal, setModal] = useState(""),
    [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState("Medium"),
    [taskOwnerUid, setTaskOwnerUid] = useState(""),
    [busy, setBusy] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 7000);
    return () => window.clearTimeout(timeout);
  }, [toast]);
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
      onSnapshot(
        query(
          collection(db, "teams", teamId, "milestones"),
          orderBy("dueAt", "asc"),
          limit(100),
        ),
        (s) =>
          setMilestones(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Item)),
      ),
      onSnapshot(
        query(
          collection(db, "teams", teamId, "weeklyReviews"),
          orderBy("weekStart", "desc"),
          limit(50),
        ),
        (s) =>
          setWeeklyReviews(
            s.docs.map((d) => ({ id: d.id, ...d.data() }) as Item),
          ),
      ),
      onSnapshot(
        query(
          collection(db, "users", user!.uid, "notifications"),
          orderBy("createdAt", "desc"),
          limit(50),
        ),
        (s) => {
          const next = s.docs.map((d) => ({ id: d.id, ...d.data() }) as Item);
          if (notificationSnapshotUid.current !== user!.uid) {
            notificationSnapshotUid.current = user!.uid;
            notificationIds.current = new Set(next.map((item) => item.id));
          } else {
            const newest = next.find(
              (item) => !item.read && !notificationIds.current.has(item.id),
            );
            if (newest) setToast(`${newest.title}: ${newest.body}`);
            notificationIds.current = new Set(next.map((item) => item.id));
          }
          setNotifications(next);
        },
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
    if (!teamId || !user || memberRole === "Viewer") return;
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
      const data = snapshot.data() || {};
      setCompany({ id: snapshot.id, ...data });
      setTeamName(data.name || "Founder workspace");
    });
    return () => {
      unsubscribeMembers();
      unsubscribeTeam();
    };
  }, [teamId, user]);
  useEffect(() => {
    if (!company) return;
    setCompanyDraft({
      name: company.name || "",
      legalName: company.legalName || "",
      website: company.website || "",
      industry: company.industry || "",
      stage: company.stage || "",
      country: company.country || "",
      region: company.region || "",
      defaultTimezone: company.defaultTimezone || company.timezone || zone,
    });
  }, [
    company?.name,
    company?.legalName,
    company?.website,
    company?.industry,
    company?.stage,
    company?.country,
    company?.region,
    company?.defaultTimezone,
    company?.timezone,
    zone,
  ]);
  useEffect(() => {
    let active = true;
    if (!company?.companyLogoPath) {
      setCompanyLogoUrl("");
      return;
    }
    getDownloadURL(storageRef(storage, company.companyLogoPath))
      .then((url) => active && setCompanyLogoUrl(url))
      .catch(() => active && setCompanyLogoUrl(""));
    return () => {
      active = false;
    };
  }, [company?.companyLogoPath, company?.companyLogoUpdatedAt]);
  useEffect(() => {
    setLocationDraft({
      country: profile?.country || "",
      region: profile?.region || "",
    });
  }, [profile]);
  useEffect(() => {
    if (!user) return;
    setMemberTitleDraft(
      members.find((member) => member.id === user.uid)?.title || "",
    );
  }, [members, user]);
  useEffect(() => {
    const own = members.find((member) => member.id === user?.uid);
    if (!own) return;
    setAvailabilityDraft({
      status: own.availabilityStatus || "Auto",
      workingDays: own.workingDays || [1, 2, 3, 4, 5],
      start: own.workdayStart || "09:00",
      end: own.workdayEnd || "17:00",
    });
  }, [members, user]);
  useEffect(() => {
    if (reviewDraft.weekStart) return;
    const today = new Date(`${dateKeyInTimezone(new Date(), zone)}T12:00:00Z`);
    today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    setReviewDraft((draft) => ({
      ...draft,
      weekStart: today.toISOString().slice(0, 10),
    }));
  }, [reviewDraft.weekStart, zone]);
  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
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
    setAttendeeEmails("");
    setMeetingStart("");
    setMeetingEnd("");
    setScheduleMeetingOnCreate(false);
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
      setCompany(null);
      setCompanyLogoUrl("");
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
  const createGoogleMeet = async (task: Item) => {
    if (!teamId || !user || memberRole === "Viewer") return;
    const start = task.meetingStart?.toDate
      ? task.meetingStart.toDate()
      : new Date(task.meetingStart);
    const end = task.meetingEnd?.toDate
      ? task.meetingEnd.toDate()
      : new Date(task.meetingEnd);
    if (!task.meetingStart || !task.meetingEnd || end <= start) {
      setToast("Add a valid meeting time before creating its join link.");
      return;
    }
    if (task.meetingUrl) return;
    if (task.googleCalendarEventId) {
      setToast("Google is still preparing the Meet link for this event.");
      return;
    }
    setBusy(true);
    try {
      const accessToken = await requestGoogleCalendarAccess();
      const invitedEmails = attendeeEmails
        .split(/[\s,;]+/)
        .map((email) => email.trim())
        .filter(Boolean);
      const assigneeEmail =
        members.find((member) => member.id === task.ownerUid)?.email || "";
      if (
        assigneeEmail &&
        task.ownerUid !== user.uid &&
        !invitedEmails.some(
          (email) => email.toLowerCase() === assigneeEmail.toLowerCase(),
        )
      ) {
        invitedEmails.push(assigneeEmail);
      }
      const meeting = await scheduleGoogleMeeting(
        {
          title: `FounderOS · ${task.title}`,
          description: task.description || task.title,
          start,
          end,
          timezone: task.timezone || zone,
          attendeeEmails: invitedEmails,
        },
        accessToken,
      );
      const batch = writeBatch(db);
      batch.update(doc(db, "teams", teamId, "tasks", task.id), {
        googleCalendarEventId: meeting.eventId,
        meetingUrl: meeting.meetUrl,
        calendarEventUrl: meeting.htmlLink || "",
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, "teams", teamId, "activity")), {
        type: "meeting_link_created",
        title: "Created a Google Meet link",
        detail: task.title,
        actor: user.uid,
        entityId: task.id,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setSelectedTask((current) =>
        current?.id === task.id
          ? {
              ...current,
              googleCalendarEventId: meeting.eventId,
              meetingUrl: meeting.meetUrl,
              calendarEventUrl: meeting.htmlLink || "",
            }
          : current,
      );
      setToast(
        meeting.meetUrl
          ? "Google Meet link created"
          : "Calendar event created; Google is still preparing the Meet link. Try again shortly.",
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
  const createMeeting = async () => {
    if (!teamId || !selectedTask || !meetingStart || !meetingEnd || !user)
      return;
    setBusy(true);
    try {
      const accessToken = await requestGoogleCalendarAccess();
      const invitedEmails = attendeeEmails
        .split(/[\s,;]+/)
        .map((email) => email.trim())
        .filter(Boolean);
      const assigneeEmail =
        members.find((member) => member.id === selectedTask.ownerUid)?.email ||
        "";
      if (
        assigneeEmail &&
        selectedTask.ownerUid !== user.uid &&
        !invitedEmails.some(
          (email) => email.toLowerCase() === assigneeEmail.toLowerCase(),
        )
      ) {
        invitedEmails.push(assigneeEmail);
      }
      const meeting = await scheduleGoogleMeeting(
        {
          title: `FounderOS · ${selectedTask.title}`,
          description: selectedTask.description || selectedTask.title,
          start: toUtcInstant(meetingStart, zone),
          end: toUtcInstant(meetingEnd, zone),
          timezone: zone,
          attendeeEmails: invitedEmails,
        },
        accessToken,
      );
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
      const scheduledTask = {
        ...selectedTask,
        googleCalendarEventId: meeting.eventId,
        meetingUrl: meeting.meetUrl,
        calendarEventUrl: meeting.htmlLink || "",
        meetingStart: toUtcInstant(meetingStart, zone),
        meetingEnd: toUtcInstant(meetingEnd, zone),
      };
      setSelectedTask(scheduledTask);
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
    if (
      modal === "task" &&
      scheduleMeetingOnCreate &&
      (!meetingStart ||
        !meetingEnd ||
        toUtcInstant(meetingEnd, zone) <= toUtcInstant(meetingStart, zone))
    )
      return;
    setBusy(true);
    try {
      const accessToken =
        modal === "task" && scheduleMeetingOnCreate
          ? await requestGoogleCalendarAccess()
          : undefined;
      const ownerUid = taskOwnerUid || user.uid;
      const createdId = await addItem(
        teamId,
        modal === "commitment"
          ? "commitments"
          : modal === "project"
            ? "projects"
            : modal === "milestone"
              ? "milestones"
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
          : modal === "milestone"
            ? {
                title: title.trim(),
                ...(description.trim()
                  ? { description: description.trim() }
                  : {}),
                status: "Planned",
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
                ...(modal === "task" && scheduleMeetingOnCreate
                  ? {
                      meetingStart: toUtcInstant(meetingStart, zone),
                      meetingEnd: toUtcInstant(meetingEnd, zone),
                      timezone: zone,
                    }
                  : {}),
              },
        user.uid,
      );
      setModal("");
      if (modal === "task" && scheduleMeetingOnCreate) {
        try {
          const assigneeEmail =
            members.find((member) => member.id === ownerUid)?.email || "";
          const invitedEmails = attendeeEmails
            .split(/[\s,;]+/)
            .map((email) => email.trim())
            .filter(Boolean);
          if (
            assigneeEmail &&
            ownerUid !== user.uid &&
            !invitedEmails.some(
              (email) => email.toLowerCase() === assigneeEmail.toLowerCase(),
            )
          ) {
            invitedEmails.push(assigneeEmail);
          }
          const meeting = await scheduleGoogleMeeting(
            {
              title: `FounderOS · ${title.trim()}`,
              description: description.trim() || title.trim(),
              start: toUtcInstant(meetingStart, zone),
              end: toUtcInstant(meetingEnd, zone),
              timezone: zone,
              attendeeEmails: invitedEmails,
            },
            accessToken,
          );
          const batch = writeBatch(db);
          batch.update(doc(db, "teams", teamId, "tasks", createdId), {
            googleCalendarEventId: meeting.eventId,
            meetingUrl: meeting.meetUrl,
            calendarEventUrl: meeting.htmlLink || "",
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(collection(db, "teams", teamId, "activity")), {
            type: "meeting_scheduled",
            title: "Scheduled a Google Calendar meeting",
            detail: title.trim(),
            actor: user.uid,
            entityId: createdId,
            createdAt: serverTimestamp(),
          });
          await batch.commit();
          setToast(
            meeting.meetUrl
              ? "Task saved, Calendar invites sent, and Meet link created"
              : "Task saved and Calendar invites sent; Google is preparing the Meet link. Open the Calendar event for details.",
          );
        } catch (error) {
          setToast(
            error instanceof Error
              ? `Task saved with its meeting time, but Google Calendar could not finish: ${error.message}`
              : "Task saved with its meeting time, but Google Calendar could not finish. Open the task to retry.",
          );
        }
      } else {
        setToast("Saved to your workspace");
      }
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Could not save. Try again.",
      );
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
      const batch = writeBatch(db);
      batch.update(doc(db, "users", user.uid), {
        timezone,
        timezoneSource: source,
        timezoneConfirmed: true,
        updatedAt: serverTimestamp(),
      });
      if (teamId) {
        batch.update(doc(db, "teams", teamId, "members", user.uid), {
          timezone,
        });
      }
      await batch.commit();
      setZone(timezone);
      setTimezoneDraft(timezone);
      setTimezonePrompt(null);
      setToast("Timezone preference saved");
    } catch {
      setToast("Could not save your timezone. Try again.");
    }
  };
  const saveAvailability = async () => {
    if (!user || !teamId || !availabilityDraft.workingDays.length) return;
    try {
      await updateDoc(doc(db, "teams", teamId, "members", user.uid), {
        availabilityStatus: availabilityDraft.status,
        workingDays: availabilityDraft.workingDays,
        workdayStart: availabilityDraft.start,
        workdayEnd: availabilityDraft.end,
      });
      setToast("Availability and working hours saved");
    } catch {
      setToast("Could not save your availability. Check your connection.");
    }
  };
  const saveWeeklyReview = async () => {
    if (!user || !teamId || !reviewDraft.weekStart || busy) return;
    setBusy(true);
    const reviewRef = doc(
      db,
      "teams",
      teamId,
      "weeklyReviews",
      `${user.uid}_${reviewDraft.weekStart}`,
    );
    try {
      const current = await getDoc(reviewRef);
      const batch = writeBatch(db);
      const values = {
        wins: reviewDraft.wins.trim(),
        misses: reviewDraft.misses.trim(),
        blockers: reviewDraft.blockers.trim(),
        priorities: reviewDraft.priorities.trim(),
        reflection: reviewDraft.reflection.trim(),
      };
      if (current.exists()) {
        batch.set(doc(collection(reviewRef, "versions")), {
          ownerUid: user.uid,
          savedAt: serverTimestamp(),
          values: current.data(),
        });
        batch.update(reviewRef, { ...values, updatedAt: serverTimestamp() });
      } else {
        batch.set(reviewRef, {
          ownerUid: user.uid,
          weekStart: reviewDraft.weekStart,
          ...values,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      batch.set(doc(collection(db, "teams", teamId, "activity")), {
        type: current.exists()
          ? "weekly_review_updated"
          : "weekly_review_created",
        title: current.exists()
          ? "Updated a weekly review"
          : "Completed a weekly review",
        detail: `Week of ${reviewDraft.weekStart}`,
        actor: user.uid,
        entityId: reviewRef.id,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setToast("Weekly review saved for your team");
    } catch {
      setToast("Could not save your weekly review. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const markNotificationRead = async (notification: Item) => {
    if (!user || notification.read) return;
    try {
      await updateDoc(
        doc(db, "users", user.uid, "notifications", notification.id),
        {
          read: true,
          readAt: serverTimestamp(),
        },
      );
    } catch {
      setToast("Could not update this notification.");
    }
  };
  const changeMilestone = async (milestone: Item) => {
    if (!teamId || !user || memberRole === "Viewer") return;
    const status = milestone.status === "Completed" ? "Planned" : "Completed";
    const batch = writeBatch(db);
    batch.update(doc(db, "teams", teamId, "milestones", milestone.id), {
      status,
      completedAt: status === "Completed" ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(db, "teams", teamId, "activity")), {
      type: "milestone_updated",
      title:
        status === "Completed"
          ? "Completed a milestone"
          : "Reopened a milestone",
      detail: milestone.title,
      actor: user.uid,
      entityId: milestone.id,
      createdAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      setToast(
        status === "Completed" ? "Milestone completed" : "Milestone reopened",
      );
    } catch {
      setToast("Could not update this milestone.");
    }
  };
  const saveCompany = async () => {
    if (!teamId || !canManageTeam || !companyDraft.name.trim()) return;
    setBusy(true);
    const values = {
      name: companyDraft.name.trim(),
      legalName: companyDraft.legalName.trim(),
      website: companyDraft.website.trim(),
      industry: companyDraft.industry.trim(),
      stage: companyDraft.stage,
      country: companyDraft.country.trim(),
      region: companyDraft.region.trim(),
      defaultTimezone: companyDraft.defaultTimezone,
      timezone: companyDraft.defaultTimezone,
      companyProfileComplete: true,
      profileCompletedAt: serverTimestamp(),
    };
    try {
      await updateDoc(doc(db, "teams", teamId), values);
      setTeamName(values.name);
      setWorkspaces((current) =>
        current.map((workspace) =>
          workspace.id === teamId
            ? { ...workspace, name: values.name }
            : workspace,
        ),
      );
      setToast("Company profile saved");
    } catch {
      setToast(
        "Could not save company profile. Check your access and connection.",
      );
    } finally {
      setBusy(false);
    }
  };
  const uploadCompanyLogo = async (file?: File) => {
    if (!teamId || !canManageTeam || !file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setToast("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setToast("Company logos must be 2 MB or smaller.");
      return;
    }
    setBusy(true);
    const path = `company-logos/${teamId}/logo`;
    try {
      await uploadBytes(storageRef(storage, path), file, {
        contentType: file.type,
        cacheControl: "public,max-age=3600",
      });
      await updateDoc(doc(db, "teams", teamId), {
        companyLogoPath: path,
        companyLogoUpdatedAt: serverTimestamp(),
      });
      setToast("Company logo updated for the whole team");
    } catch {
      setToast("Could not upload the logo. Check Firebase Storage is enabled.");
    } finally {
      setBusy(false);
    }
  };
  const removeCompanyLogo = async () => {
    if (!teamId || !canManageTeam || !company?.companyLogoPath) return;
    setBusy(true);
    const path = company.companyLogoPath;
    try {
      await updateDoc(doc(db, "teams", teamId), {
        companyLogoPath: deleteField(),
        companyLogoUpdatedAt: serverTimestamp(),
      });
      await deleteObject(storageRef(storage, path)).catch(() => undefined);
      setCompanyLogoUrl("");
      setToast("Company logo removed");
    } catch {
      setToast("Could not remove the company logo.");
    } finally {
      setBusy(false);
    }
  };
  const saveLocation = async () => {
    if (!user || !teamId) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "users", user.uid), {
        country: locationDraft.country.trim(),
        region: locationDraft.region.trim(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, "teams", teamId, "members", user.uid), {
        country: locationDraft.country.trim(),
        region: locationDraft.region.trim(),
      });
      await batch.commit();
      setToast("Your location is visible to your team");
    } catch {
      setToast("Could not save your location. Try again.");
    }
  };
  const saveMemberTitle = async (member: Item, titleValue: string) => {
    if (!teamId || !user || (member.id !== user.uid && !canManageTeam)) return;
    const title = titleValue.trim().slice(0, 80);
    if ((member.title || "") === title) return;
    try {
      await updateDoc(doc(db, "teams", teamId, "members", member.id), {
        title,
      });
      setToast("Team title updated");
    } catch {
      setToast("Could not update this business title.");
    }
  };
  const displayName = user?.displayName?.split(" ")[0] || "Founder";
  const activityActorLabel = (actor?: string) => {
    if (!actor) return "A teammate";
    if (actor === user?.uid) return "You";
    const member = members.find((candidate) => candidate.id === actor);
    return (
      member?.displayName?.trim() ||
      member?.email?.split("@")[0] ||
      "A teammate"
    );
  };
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
  const overviewTasks = [...tasks].sort((first, second) => {
    const priorityWeight: Record<string, number> = {
      Critical: 0,
      High: 1,
      Medium: 2,
      Low: 3,
    };
    const priorityOrder =
      (priorityWeight[first.priority] ?? 4) -
      (priorityWeight[second.priority] ?? 4);
    if (priorityOrder !== 0) return priorityOrder;
    const firstOpen = first.status === "Completed" ? 1 : 0;
    const secondOpen = second.status === "Completed" ? 1 : 0;
    if (firstOpen !== secondOpen) return firstOpen - secondOpen;
    const firstDue = dueInstant(first)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const secondDue = dueInstant(second)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return firstDue - secondDue;
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
        {toast && (
          <div className="toast" role="status" aria-live="polite">
            {toast}
            <button
              className="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </main>
    );

  if (
    user &&
    teamId &&
    company &&
    company.companyProfileComplete !== true &&
    memberRole === "Owner"
  )
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="brand-mark">
            {companyLogoUrl ? (
              <img
                className="setup-company-logo"
                src={companyLogoUrl}
                alt="Company logo"
                onError={() => setCompanyLogoUrl("")}
              />
            ) : (
              <Command size={17} />
            )}
          </div>
          <div className="panel-kicker">FIRST, SET UP YOUR COMPANY</div>
          <h1>Give your team a shared home.</h1>
          <p className="setup-intro">
            Add the company basics and a default timezone. Each teammate keeps
            their own local timezone, so deadlines and meeting times stay clear
            across countries.
          </p>
          <div className="company-form">
            <label>
              Company name{" "}
              <input
                required
                maxLength={120}
                value={companyDraft.name}
                onChange={(event) =>
                  setCompanyDraft({ ...companyDraft, name: event.target.value })
                }
                placeholder="e.g. Acme Labs"
              />
            </label>
            <label>
              Country{" "}
              <input
                maxLength={80}
                value={companyDraft.country}
                onChange={(event) =>
                  setCompanyDraft({
                    ...companyDraft,
                    country: event.target.value,
                  })
                }
                placeholder="e.g. India"
              />
            </label>
            <label>
              Region or state{" "}
              <input
                maxLength={80}
                value={companyDraft.region}
                onChange={(event) =>
                  setCompanyDraft({
                    ...companyDraft,
                    region: event.target.value,
                  })
                }
                placeholder="e.g. Karnataka"
              />
            </label>
            <label>
              Company timezone{" "}
              <select
                value={companyDraft.defaultTimezone}
                onChange={(event) =>
                  setCompanyDraft({
                    ...companyDraft,
                    defaultTimezone: event.target.value,
                  })
                }
              >
                {[
                  ...new Set([
                    companyDraft.defaultTimezone,
                    ...timezoneOptions,
                  ]),
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="company-logo-control">
            <div className="company-logo-preview">
              {companyLogoUrl ? (
                <img
                  src={companyLogoUrl}
                  alt="Company logo"
                  onError={() => setCompanyLogoUrl("")}
                />
              ) : (
                <span>
                  {companyDraft.name.trim().slice(0, 1).toUpperCase() || "C"}
                </span>
              )}
            </div>
            <div>
              <b>Company logo</b>
              <small>PNG, JPG, or WebP · up to 2 MB</small>
            </div>
            <label className="secondary-button logo-upload-button">
              {busy
                ? "Uploading…"
                : companyLogoUrl
                  ? "Replace logo"
                  : "Upload logo"}
              <input
                aria-label="Upload company logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(event) => {
                  void uploadCompanyLogo(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <button
            className="primary-button setup-submit"
            disabled={
              busy || !companyDraft.name.trim() || !companyDraft.country.trim()
            }
            onClick={saveCompany}
          >
            {busy ? "Saving…" : "Set up company"}
            <ArrowRight size={15} />
          </button>
          <small>
            Team members can add their own region and timezone after you invite
            them.
          </small>
        </section>
      </main>
    );
  if (
    user &&
    teamId &&
    company &&
    company.companyProfileComplete !== true &&
    memberRole !== "Owner"
  )
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="brand-mark">
            <Clock3 size={17} />
          </div>
          <div className="panel-kicker">COMPANY SETUP IN PROGRESS</div>
          <h1>Your team workspace is getting ready.</h1>
          <p className="setup-intro">
            The workspace owner is adding the company profile. You can continue
            once setup is complete.
          </p>
          <button className="secondary-button" onClick={() => signOut(auth)}>
            <LogOut size={15} /> Sign out
          </button>
        </section>
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
            : section === "Milestones"
              ? milestones
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
  const busyIntervals = scheduledMeetings.map((meeting) => ({
    start: meeting.meetingStart?.toDate
      ? meeting.meetingStart.toDate()
      : new Date(meeting.meetingStart),
    end: meeting.meetingEnd?.toDate
      ? meeting.meetingEnd.toDate()
      : new Date(meeting.meetingEnd),
  }));
  const commonTimeSlots = findCommonTimeSlots(
    members,
    busyIntervals,
    clockNow,
    30,
    4,
  );
  const timelineItems: Item[] = [
    ...tasks
      .filter((item) => dueInstant(item))
      .map((item) => ({
        ...item,
        timelineType: "Task",
        timelineAt: dueInstant(item)!,
      })),
    ...commitments
      .filter((item) => dueInstant(item))
      .map((item) => ({
        ...item,
        timelineType: "Commitment",
        timelineAt: dueInstant(item)!,
      })),
    ...milestones
      .filter((item) => dueInstant(item))
      .map((item) => ({
        ...item,
        timelineType: "Milestone",
        timelineAt: dueInstant(item)!,
      })),
    ...scheduledMeetings.map((item) => ({
      ...item,
      timelineType: "Meeting",
      timelineAt: item.meetingStart?.toDate
        ? item.meetingStart.toDate()
        : new Date(item.meetingStart),
    })),
  ].sort(
    (first, second) => first.timelineAt.getTime() - second.timelineAt.getTime(),
  );
  const unreadNotifications = notifications.filter(
    (notification) => !notification.read,
  ).length;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "show" : ""}`}>
        <div className="sidebar-brand">
          <div className="sidebar-company-logo">
            {companyLogoUrl ? (
              <img
                src={companyLogoUrl}
                alt={`${company?.name || teamName} logo`}
                onError={() => setCompanyLogoUrl("")}
              />
            ) : (
              <span>
                {(company?.name || teamName || "C")
                  .trim()
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
            )}
          </div>
          <span
            className="sidebar-company-name"
            title={company?.name || teamName}
          >
            {company?.name || teamName || "Your company"}
          </span>
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
                  {item.name === "Notifications" && unreadNotifications > 0 && (
                    <small className="nav-count">{unreadNotifications}</small>
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
            <div className="notification-menu">
              <button
                className="icon-button notification-trigger"
                aria-label={`${unreadNotifications} unread notifications`}
                aria-expanded={quickNotificationsOpen}
                aria-controls="quick-notifications"
                title="Notifications"
                onClick={() => setQuickNotificationsOpen((isOpen) => !isOpen)}
              >
                <Bell size={17} />
                {unreadNotifications > 0 && (
                  <i>{Math.min(unreadNotifications, 99)}</i>
                )}
              </button>
              {quickNotificationsOpen && (
                <div
                  className="notification-popover"
                  id="quick-notifications"
                  role="dialog"
                  aria-label="Quick notifications"
                >
                  <div className="notification-popover-heading">
                    <b>Quick notifications</b>
                    <button
                      className="icon-button"
                      aria-label="Close quick notifications"
                      onClick={() => setQuickNotificationsOpen(false)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {notifications.slice(0, 5).map((notification) => (
                    <button
                      className={`quick-notification-item ${notification.read ? "read" : "unread"}`}
                      key={notification.id}
                      onClick={() => {
                        void markNotificationRead(notification);
                        const task = tasks.find(
                          (item) => item.id === notification.targetId,
                        );
                        if (task) {
                          setSelectedTask(task);
                          setDescription(task.description || "");
                        }
                        setQuickNotificationsOpen(false);
                      }}
                    >
                      <span className="notification-dot" />
                      <span>
                        <b>{notification.title}</b>
                        <small>{notification.body}</small>
                      </span>
                    </button>
                  ))}
                  {!notifications.length && (
                    <p className="quick-notification-empty">
                      You’re all caught up.
                    </p>
                  )}
                  <button
                    className="quick-notification-all"
                    onClick={() => {
                      setQuickNotificationsOpen(false);
                      setSection("Notifications");
                    }}
                  >
                    View all notifications <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
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
                        ? "Schedule meetings directly from the tasks your team is doing."
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
                      : section === "Milestones"
                        ? "milestone"
                        : "task",
                )
              }
            >
              <Plus size={16} /> Add{" "}
              {section === "Commitments"
                ? "commitment"
                : section === "Projects"
                  ? "project"
                  : section === "Milestones"
                    ? "milestone"
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
                      <div className="panel-kicker">YOUR COMPANY WORK</div>
                      <h2>
                        All tasks{" "}
                        <span className="pill-count">
                          {overviewTasks.length}
                        </span>
                      </h2>
                    </div>
                    <button
                      className="text-action"
                      onClick={() => setSection("Team tasks")}
                    >
                      View all <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="task-list">
                    {overviewTasks.map((t) => (
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
                    {!overviewTasks.length && (
                      <Empty
                        title="No tasks yet."
                        text="Add your first task to see company work here."
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
                        {activityActorLabel(a.actor).slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p>
                          <b>{activityActorLabel(a.actor)}</b>{" "}
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
              <p className="settings-description">
                Business titles such as Co-founder are separate from access
                roles. Location and live local time help your team coordinate
                across regions.
              </p>
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
                    <small>
                      {member.title || "Team member"} · {member.email}
                    </small>
                    <small>
                      {[member.region, member.country]
                        .filter(Boolean)
                        .join(", ") || "Location not set"}{" "}
                      · {member.timezone || "Timezone not set"}
                    </small>
                    {member.timezone && (
                      <small className="member-local-time">
                        Local time {formatMemberTime(clockNow, member.timezone)}
                      </small>
                    )}
                  </div>
                  {canManageTeam && member.id !== user.uid ? (
                    <div className="member-controls">
                      <input
                        aria-label={`Business title for ${member.email}`}
                        className="member-title-input"
                        defaultValue={member.title || ""}
                        placeholder="Business title · e.g. Co-founder"
                        maxLength={80}
                        onBlur={(event) =>
                          saveMemberTitle(member, event.target.value)
                        }
                      />
                      {member.role !== "Owner" && (
                        <>
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
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="role-chip">{member.role} access</span>
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
          ) : section === "Availability" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">DISTRIBUTED TEAM TIME</div>
              <h2>Set your working hours</h2>
              <p className="settings-description">
                Hours are interpreted in your saved timezone ({zone}). Common
                slots below exclude your team’s scheduled meetings and respect
                each member’s workdays.
              </p>
              <div className="availability-form">
                <label>
                  Availability status
                  <select
                    value={availabilityDraft.status}
                    onChange={(event) =>
                      setAvailabilityDraft({
                        ...availabilityDraft,
                        status: event.target.value,
                      })
                    }
                  >
                    {["Auto", "Available", "Busy", "Focus time", "Away"].map(
                      (status) => (
                        <option key={status}>{status}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Start
                  <input
                    type="time"
                    value={availabilityDraft.start}
                    onChange={(event) =>
                      setAvailabilityDraft({
                        ...availabilityDraft,
                        start: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    type="time"
                    value={availabilityDraft.end}
                    onChange={(event) =>
                      setAvailabilityDraft({
                        ...availabilityDraft,
                        end: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div className="working-days">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day, index) => (
                    <button
                      key={day}
                      className={
                        availabilityDraft.workingDays.includes(index)
                          ? "working-day selected"
                          : "working-day"
                      }
                      aria-pressed={availabilityDraft.workingDays.includes(
                        index,
                      )}
                      onClick={() =>
                        setAvailabilityDraft({
                          ...availabilityDraft,
                          workingDays: availabilityDraft.workingDays.includes(
                            index,
                          )
                            ? availabilityDraft.workingDays.filter(
                                (value) => value !== index,
                              )
                            : [...availabilityDraft.workingDays, index].sort(),
                        })
                      }
                    >
                      {day}
                    </button>
                  ),
                )}
              </div>
              <button
                className="secondary-button"
                disabled={
                  !availabilityDraft.workingDays.length ||
                  availabilityDraft.start >= availabilityDraft.end
                }
                onClick={saveAvailability}
              >
                Save availability
              </button>
              <div className="settings-subheading">
                <div className="panel-kicker">YOUR TEAM RIGHT NOW</div>
                <h3>Local time and availability</h3>
              </div>
              {members.map((member) => (
                <div className="settings-line" key={member.id}>
                  <div>
                    <b>
                      {member.displayName || member.email}
                      {member.id === user.uid ? " · You" : ""}
                    </b>
                    <small>
                      {member.timezone || "Timezone not set"} ·{" "}
                      {formatMemberTime(clockNow, member.timezone || "UTC")}
                    </small>
                  </div>
                  <span className="availability-chip">
                    {getMemberAvailability(member, tasks, clockNow)}
                  </span>
                </div>
              ))}
              <div className="settings-subheading">
                <div className="panel-kicker">FIND A TIME</div>
                <h3>Shared 30-minute windows</h3>
                <p>
                  Windows use everyone’s working hours and avoid the team’s
                  current scheduled meetings. Connect calendars for conflict
                  checks across personal events.
                </p>
              </div>
              {commonTimeSlots.map((slot) => (
                <div
                  className="settings-line common-slot"
                  key={slot.toISOString()}
                >
                  <div>
                    <b>{formatInstantInTimezone(slot, zone)}</b>
                    <small>
                      {members
                        .map(
                          (member) =>
                            `${member.displayName || member.email}: ${formatInstantInTimezone(slot, member.timezone || "UTC")}`,
                        )
                        .join(" · ")}
                    </small>
                  </div>
                  <button
                    className="text-action"
                    onClick={() => {
                      setSection("Meetings");
                      setToast(
                        "Select a task to schedule a team meeting for this time.",
                      );
                    }}
                  >
                    Plan meeting
                  </button>
                </div>
              ))}
              {!commonTimeSlots.length && (
                <p className="form-hint">
                  No shared work-hour window found in the next two weeks. Adjust
                  your schedules or availability status.
                </p>
              )}
            </div>
          ) : section === "Milestones" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">COMPANY OUTCOMES</div>
              <h2>Milestones</h2>
              <p className="settings-description">
                Track outcomes the team is moving toward. Link each milestone to
                a project through its title and description.
              </p>
              {milestones.map((milestone) => (
                <div className="settings-line" key={milestone.id}>
                  <div>
                    <b>{milestone.title}</b>
                    <small>
                      {milestone.description || "Outcome milestone"} ·{" "}
                      {members.find(
                        (member) => member.id === milestone.ownerUid,
                      )?.displayName || "Team"}{" "}
                      · Due {formatDue(milestone, zone)}
                    </small>
                  </div>
                  <span
                    className={`status-chip ${(milestone.status || "planned").toLowerCase()}`}
                  >
                    {milestone.status}
                  </span>
                  {memberRole !== "Viewer" && (
                    <button
                      className="text-action"
                      onClick={() => void changeMilestone(milestone)}
                    >
                      {milestone.status === "Completed" ? "Reopen" : "Complete"}
                    </button>
                  )}
                </div>
              ))}
              {!milestones.length && (
                <Empty
                  title="No milestones yet."
                  text="Add a company outcome and give it an owner and target date."
                  action={() => open("milestone")}
                />
              )}
            </div>
          ) : section === "Timeline" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">WHAT HAPPENS NEXT</div>
              <h2>Company timeline</h2>
              <p className="settings-description">
                Tasks, promises, milestones, and scheduled meetings in your
                local time ({zone}).
              </p>
              {timelineItems.map((item) => (
                <div
                  className="timeline-row"
                  key={`${item.timelineType}-${item.id}`}
                >
                  <div className="timeline-marker" />
                  <div className="timeline-date">
                    {formatInstantInTimezone(item.timelineAt, zone)}
                  </div>
                  <div className="timeline-copy">
                    <small>{item.timelineType}</small>
                    <b>{item.title || item.description}</b>
                    <span>{item.status || "Scheduled"}</span>
                  </div>
                </div>
              ))}
              {!timelineItems.length && (
                <Empty
                  title="Your timeline is clear."
                  text="Add due dates and milestones to see what happens next."
                />
              )}
            </div>
          ) : section === "Accountability" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">REFLECT, DON’T COMPETE</div>
              <h2>Team accountability</h2>
              <p className="settings-description">
                Completion and overdue work are based on assigned tasks. On-time
                rate uses recorded completion timestamps and due dates.
              </p>
              {members.map((member) => {
                const assigned = tasks.filter(
                  (task) => task.ownerUid === member.id,
                );
                const completed = assigned.filter(
                  (task) => task.status === "Completed",
                );
                const overdue = assigned.filter(
                  (task) =>
                    task.status !== "Completed" &&
                    dueInstant(task) &&
                    dueInstant(task)! < clockNow,
                );
                const onTime = completed.filter(
                  (task) =>
                    task.completedAt &&
                    dueInstant(task) &&
                    (task.completedAt.toDate
                      ? task.completedAt.toDate()
                      : new Date(task.completedAt)) <= dueInstant(task)!,
                );
                const scored = completed.filter(
                  (task) => task.completedAt && dueInstant(task),
                );
                return (
                  <div className="accountability-row" key={member.id}>
                    <div>
                      <b>{member.displayName || member.email}</b>
                      <small>{member.title || member.role}</small>
                    </div>
                    <span>{completed.length} done</span>
                    <span>
                      {scored.length
                        ? Math.round((onTime.length / scored.length) * 100)
                        : "—"}
                      % on time
                    </span>
                    <span>{overdue.length} overdue</span>
                  </div>
                );
              })}
              <div className="settings-subheading">
                <div className="panel-kicker">TEAM SNAPSHOT</div>
                <h3>
                  {tasks.filter((task) => task.status === "Completed").length}{" "}
                  of {tasks.length} tasks completed ·{" "}
                  {
                    commitments.filter(
                      (commitment) => commitment.status === "Missed",
                    ).length
                  }{" "}
                  missed commitments
                </h3>
              </div>
            </div>
          ) : section === "Weekly review" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">CLOSE THE LOOP</div>
              <h2>Weekly review</h2>
              <p className="settings-description">
                Capture what happened and carry the right priorities into next
                week. Revisions preserve prior versions.
              </p>
              <div className="company-form review-form">
                <label>
                  Week starting
                  <input
                    type="date"
                    value={reviewDraft.weekStart}
                    onChange={(event) =>
                      setReviewDraft({
                        ...reviewDraft,
                        weekStart: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  What went well?
                  <textarea
                    maxLength={4000}
                    rows={3}
                    value={reviewDraft.wins}
                    onChange={(event) =>
                      setReviewDraft({
                        ...reviewDraft,
                        wins: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  What slipped or was missed?
                  <textarea
                    maxLength={4000}
                    rows={3}
                    value={reviewDraft.misses}
                    onChange={(event) =>
                      setReviewDraft({
                        ...reviewDraft,
                        misses: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  What is blocked?
                  <textarea
                    maxLength={4000}
                    rows={3}
                    value={reviewDraft.blockers}
                    onChange={(event) =>
                      setReviewDraft({
                        ...reviewDraft,
                        blockers: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Next week’s priorities
                  <textarea
                    maxLength={4000}
                    rows={3}
                    value={reviewDraft.priorities}
                    onChange={(event) =>
                      setReviewDraft({
                        ...reviewDraft,
                        priorities: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Reflection
                  <textarea
                    maxLength={4000}
                    rows={3}
                    value={reviewDraft.reflection}
                    onChange={(event) =>
                      setReviewDraft({
                        ...reviewDraft,
                        reflection: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <button
                className="primary-button"
                disabled={busy || !reviewDraft.weekStart}
                onClick={saveWeeklyReview}
              >
                {busy ? "Saving…" : "Save weekly review"}
              </button>
              <div className="settings-subheading">
                <div className="panel-kicker">TEAM REVIEW HISTORY</div>
              </div>
              {weeklyReviews.map((review) => (
                <div className="settings-line" key={review.id}>
                  <div>
                    <b>
                      {members.find((member) => member.id === review.ownerUid)
                        ?.displayName || "Team member"}{" "}
                      · week of {review.weekStart}
                    </b>
                    <small>
                      Wins: {review.wins || "—"} · Next:{" "}
                      {review.priorities || "—"}
                    </small>
                  </div>
                  <span className="secure-chip">Saved</span>
                </div>
              ))}
            </div>
          ) : section === "Notifications" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">IN-APP UPDATES</div>
              <h2>Your notifications</h2>
              <p className="settings-description">
                Assignments and task-thread updates for this account. Email and
                WhatsApp delivery need production providers and are not
                simulated.
              </p>
              {notifications.map((notification) => (
                <button
                  className={`notification-row ${notification.read ? "read" : "unread"}`}
                  key={notification.id}
                  onClick={() => {
                    void markNotificationRead(notification);
                    const task = tasks.find(
                      (item) => item.id === notification.targetId,
                    );
                    if (task) {
                      setSelectedTask(task);
                      setDescription(task.description || "");
                    }
                  }}
                >
                  <span className="notification-dot" />
                  <span>
                    <b>{notification.title}</b>
                    <small>
                      {notification.body} ·{" "}
                      {notification.createdAt?.toDate
                        ? formatDateInTimezone(
                            notification.createdAt.toDate(),
                            zone,
                          )
                        : "Just now"}
                    </small>
                  </span>
                  {notification.read ? (
                    <span className="secure-chip">Read</span>
                  ) : (
                    <span className="role-chip">New</span>
                  )}
                </button>
              ))}
              {!notifications.length && (
                <Empty
                  title="You’re all caught up."
                  text="Task assignments and replies will appear here."
                />
              )}
            </div>
          ) : section === "Settings" ? (
            <div className="panel simple-panel">
              <div className="panel-kicker">COMPANY & TEAM SETTINGS</div>
              <h2>Company profile</h2>
              <p className="settings-description">
                A shared company identity for everyone in this workspace.
                Company defaults help teams coordinate; each person’s own
                timezone remains independent.
              </p>
              <div className="company-form settings-company-form">
                <label>
                  Company name{" "}
                  <input
                    maxLength={120}
                    disabled={!canManageTeam}
                    value={companyDraft.name}
                    onChange={(event) =>
                      setCompanyDraft({
                        ...companyDraft,
                        name: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Legal name{" "}
                  <input
                    maxLength={160}
                    disabled={!canManageTeam}
                    value={companyDraft.legalName}
                    onChange={(event) =>
                      setCompanyDraft({
                        ...companyDraft,
                        legalName: event.target.value,
                      })
                    }
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Website{" "}
                  <input
                    type="url"
                    maxLength={200}
                    disabled={!canManageTeam}
                    value={companyDraft.website}
                    onChange={(event) =>
                      setCompanyDraft({
                        ...companyDraft,
                        website: event.target.value,
                      })
                    }
                    placeholder="https://example.com"
                  />
                </label>
                <label>
                  Industry{" "}
                  <input
                    maxLength={100}
                    disabled={!canManageTeam}
                    value={companyDraft.industry}
                    onChange={(event) =>
                      setCompanyDraft({
                        ...companyDraft,
                        industry: event.target.value,
                      })
                    }
                    placeholder="e.g. SaaS"
                  />
                </label>
                <label>
                  Company stage{" "}
                  <select
                    disabled={!canManageTeam}
                    value={companyDraft.stage}
                    onChange={(event) =>
                      setCompanyDraft({
                        ...companyDraft,
                        stage: event.target.value,
                      })
                    }
                  >
                    <option value="">Choose stage</option>
                    {[
                      "Idea",
                      "Pre-seed",
                      "Seed",
                      "Series A",
                      "Series B+",
                      "Bootstrapped",
                      "Growth",
                      "Other",
                    ].map((stage) => (
                      <option key={stage}>{stage}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Headquarters country{" "}
                  <input
                    maxLength={80}
                    disabled={!canManageTeam}
                    value={companyDraft.country}
                    onChange={(event) =>
                      setCompanyDraft({
                        ...companyDraft,
                        country: event.target.value,
                      })
                    }
                    placeholder="e.g. India"
                  />
                </label>
                <label>
                  Headquarters region{" "}
                  <input
                    maxLength={80}
                    disabled={!canManageTeam}
                    value={companyDraft.region}
                    onChange={(event) =>
                      setCompanyDraft({
                        ...companyDraft,
                        region: event.target.value,
                      })
                    }
                    placeholder="e.g. Karnataka"
                  />
                </label>
                <label>
                  Company default timezone{" "}
                  <select
                    disabled={!canManageTeam}
                    value={companyDraft.defaultTimezone}
                    onChange={(event) =>
                      setCompanyDraft({
                        ...companyDraft,
                        defaultTimezone: event.target.value,
                      })
                    }
                  >
                    {[
                      ...new Set([
                        companyDraft.defaultTimezone,
                        ...timezoneOptions,
                      ]),
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              {canManageTeam && (
                <button
                  className="secondary-button company-save"
                  disabled={busy || !companyDraft.name.trim()}
                  onClick={saveCompany}
                >
                  Save company profile
                </button>
              )}
              <div className="settings-subheading">
                <div className="panel-kicker">COMPANY BRAND</div>
                <h3>Make this workspace feel like yours</h3>
                <p>
                  The company logo and name appear in the workspace sidebar for
                  everyone on your team.
                </p>
              </div>
              <div className="company-logo-control">
                <div className="company-logo-preview">
                  {companyLogoUrl ? (
                    <img
                      src={companyLogoUrl}
                      alt={`${company?.name || "Company"} logo`}
                      onError={() => setCompanyLogoUrl("")}
                    />
                  ) : (
                    <span>
                      {(company?.name || teamName || "C")
                        .trim()
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <b>{companyLogoUrl ? "Company logo" : "No logo uploaded"}</b>
                  <small>PNG, JPG, or WebP · up to 2 MB</small>
                </div>
                {canManageTeam && (
                  <label className="secondary-button logo-upload-button">
                    {busy
                      ? "Uploading…"
                      : companyLogoUrl
                        ? "Replace logo"
                        : "Upload logo"}
                    <input
                      aria-label="Upload company logo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={(event) => {
                        void uploadCompanyLogo(event.currentTarget.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                )}
                {canManageTeam && company?.companyLogoPath && (
                  <button
                    className="text-action danger-action"
                    disabled={busy}
                    onClick={() => void removeCompanyLogo()}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="settings-subheading">
                <div className="panel-kicker">YOUR TEAM PROFILE</div>
                <h3>How teammates know you</h3>
                <p>
                  Your business title is separate from access permissions. Use
                  titles like Co-founder, CEO, or CTO.
                </p>
              </div>
              <div className="company-form location-form">
                <label>
                  Business title
                  <input
                    maxLength={80}
                    value={memberTitleDraft}
                    onChange={(event) =>
                      setMemberTitleDraft(event.target.value)
                    }
                    placeholder="e.g. Co-founder"
                  />
                </label>
              </div>
              <button
                className="secondary-button company-save"
                disabled={
                  memberTitleDraft ===
                  (members.find((member) => member.id === user.uid)?.title ||
                    "")
                }
                onClick={() => {
                  const self = members.find((member) => member.id === user.uid);
                  if (self) void saveMemberTitle(self, memberTitleDraft);
                }}
              >
                Save business title
              </button>
              <div className="settings-subheading">
                <div className="panel-kicker">YOUR LOCATION</div>
                <h3>Help teammates find a good time to connect</h3>
                <p>
                  Visible to workspace members. Use a city, state, region, or
                  country (for example Nairobi, Kenya or Lagos, Nigeria).
                </p>
              </div>
              <div className="company-form location-form">
                <label>
                  Country{" "}
                  <input
                    maxLength={80}
                    value={locationDraft.country}
                    onChange={(event) =>
                      setLocationDraft({
                        ...locationDraft,
                        country: event.target.value,
                      })
                    }
                    placeholder="e.g. Kenya"
                  />
                </label>
                <label>
                  Region or city{" "}
                  <input
                    maxLength={80}
                    value={locationDraft.region}
                    onChange={(event) =>
                      setLocationDraft({
                        ...locationDraft,
                        region: event.target.value,
                      })
                    }
                    placeholder="e.g. Nairobi"
                  />
                </label>
              </div>
              <button
                className="secondary-button company-save"
                disabled={
                  locationDraft.country === (profile?.country || "") &&
                  locationDraft.region === (profile?.region || "")
                }
                onClick={saveLocation}
              >
                Save location
              </button>
              <div className="settings-subheading">
                <div className="panel-kicker">YOUR PREFERENCES</div>
                <h3>Local timezone</h3>
                <p>
                  Your own timezone controls how dates and meeting times appear
                  for you.
                </p>
              </div>
              <div className="settings-line">
                <div>
                  <b>Personal timezone</b>
                  <small>Team members may be in different timezones.</small>
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
              <div className="panel-kicker">TEAM CALENDAR</div>
              <h2>Team meetings</h2>
              <p className="meetings-intro">
                Meetings scheduled from team tasks, shown in {zone}. Create a
                Google Meet link from a meeting when you’re ready.
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
                    {meeting.description && (
                      <small>{meeting.description}</small>
                    )}
                  </div>
                  <div className="meeting-actions">
                    <button
                      className="text-action"
                      onClick={() => {
                        setSelectedTask(meeting);
                        setDescription(meeting.description || "");
                        setMeetingStart("");
                        setMeetingEnd("");
                        setAttendeeEmails("");
                        setReplyTo(null);
                        setCommentDraft("");
                      }}
                    >
                      Details
                    </button>
                    {meeting.meetingUrl ? (
                      <a
                        className="meeting-link"
                        href={meeting.meetingUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Join Google Meet <ArrowRight size={13} />
                      </a>
                    ) : meeting.googleCalendarEventId ? (
                      meeting.calendarEventUrl ? (
                        <a
                          className="meeting-link"
                          href={meeting.calendarEventUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Calendar event <ArrowRight size={13} />
                        </a>
                      ) : (
                        <small className="form-hint">
                          Meet link is being prepared.
                        </small>
                      )
                    ) : memberRole !== "Viewer" ? (
                      <button
                        className="meeting-link meeting-link-button"
                        disabled={busy}
                        onClick={() => void createGoogleMeet(meeting)}
                      >
                        {busy ? "Creating link…" : "Create Google Meet link"}
                        <ArrowRight size={13} />
                      </button>
                    ) : meeting.calendarEventUrl ? (
                      <a
                        className="meeting-link"
                        href={meeting.calendarEventUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Calendar event <ArrowRight size={13} />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
              {!scheduledMeetings.length && (
                <Empty
                  title="No team meetings yet."
                  text="Open a task to add a meeting time to your team calendar."
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
                    {activityActorLabel(a.actor).slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p>
                      <b>{activityActorLabel(a.actor)}</b>{" "}
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
                        setMeetingStart("");
                        setMeetingEnd("");
                        setAttendeeEmails("");
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
                : modal === "milestone"
                  ? "What outcome will the company reach?"
                  : modal === "project"
                    ? "What are you building?"
                    : "What needs to get done?"}
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  modal === "commitment"
                    ? "I will…"
                    : modal === "milestone"
                      ? "A measurable company outcome"
                      : "Give it a clear name"
                }
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </label>
            {(modal === "task" ||
              modal === "project" ||
              modal === "milestone") && (
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
            {(modal === "task" || modal === "milestone") && (
              <label>
                {modal === "milestone" ? "Milestone owner" : "Task owner"}
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
            {modal === "task" && (
              <section className="task-meeting-create">
                <label className="meeting-create-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleMeetingOnCreate}
                    onChange={(event) =>
                      setScheduleMeetingOnCreate(event.target.checked)
                    }
                  />
                  <span>
                    <b>Schedule a meeting</b>
                    <small>
                      Add the meeting to your team calendar when you save.
                    </small>
                  </span>
                </label>
                {scheduleMeetingOnCreate && (
                  <div className="meeting-create-fields">
                    <label>
                      Invite by email
                      <input
                        type="text"
                        value={attendeeEmails}
                        onChange={(event) =>
                          setAttendeeEmails(event.target.value)
                        }
                        placeholder="teammate@company.com, guest@example.com"
                        autoComplete="off"
                      />
                    </label>
                    <small className="form-hint">
                      Google Calendar sends the invitations. The task owner is
                      invited automatically when they are someone else.
                    </small>
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
                    <small className="form-hint">
                      Team members can see it in the Meetings and Calendar
                      views.
                    </small>
                    {meetingStart &&
                      meetingEnd &&
                      toUtcInstant(meetingEnd, zone) <=
                        toUtcInstant(meetingStart, zone) && (
                        <small className="form-hint meeting-error">
                          Choose an end time after the meeting start.
                        </small>
                      )}
                  </div>
                )}
              </section>
            )}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setModal("")}>
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={
                  !title.trim() ||
                  busy ||
                  (modal !== "project" && !due) ||
                  (modal === "task" &&
                    scheduleMeetingOnCreate &&
                    (!meetingStart ||
                      !meetingEnd ||
                      toUtcInstant(meetingEnd, zone) <=
                        toUtcInstant(meetingStart, zone)))
                }
                onClick={create}
              >
                {busy ? (
                  scheduleMeetingOnCreate && modal === "task" ? (
                    "Saving task and meeting…"
                  ) : (
                    "Saving…"
                  )
                ) : (
                  <>
                    {scheduleMeetingOnCreate && modal === "task"
                      ? "Save task & schedule meeting"
                      : `Save ${modal}`}{" "}
                    <ArrowRight size={14} />
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
                <div className="panel-kicker">TEAM CALENDAR</div>
                <h3>
                  {selectedTask.meetingStart
                    ? "Meeting details"
                    : "Schedule a team meeting"}
                </h3>
                {!selectedTask.meetingStart && (
                  <p>
                    Set the time here; teammates can see it in the Meetings and
                    Calendar views.
                  </p>
                )}
                {selectedTask.meetingStart && selectedTask.meetingEnd && (
                  <p className="meeting-scheduled-time">
                    {formatInstantInTimezone(
                      selectedTask.meetingStart?.toDate
                        ? selectedTask.meetingStart.toDate()
                        : new Date(selectedTask.meetingStart),
                      zone,
                    )}{" "}
                    –{" "}
                    {formatInstantInTimezone(
                      selectedTask.meetingEnd?.toDate
                        ? selectedTask.meetingEnd.toDate()
                        : new Date(selectedTask.meetingEnd),
                      zone,
                    )}
                  </p>
                )}
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
                {selectedTask.meetingStart &&
                  !selectedTask.meetingUrl &&
                  memberRole !== "Viewer" &&
                  !selectedTask.googleCalendarEventId && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void createGoogleMeet(selectedTask)}
                    >
                      {busy ? "Creating link…" : "Create Google Meet link"}{" "}
                      <ArrowRight size={14} />
                    </button>
                  )}
                {selectedTask.meetingStart &&
                  !selectedTask.meetingUrl &&
                  !selectedTask.googleCalendarEventId && (
                    <small className="form-hint">
                      A Google Meet join link hasn’t been created yet.
                    </small>
                  )}
                {selectedTask.googleCalendarEventId &&
                  !selectedTask.meetingUrl && (
                    <small className="form-hint">
                      Meet link is being prepared. Open the Calendar event to
                      view its details.
                    </small>
                  )}
                {memberRole !== "Viewer" && (
                  <>
                    <label>
                      Invite by email
                      <input
                        type="text"
                        value={attendeeEmails}
                        onChange={(event) =>
                          setAttendeeEmails(event.target.value)
                        }
                        placeholder="teammate@company.com, guest@example.com"
                        autoComplete="off"
                      />
                    </label>
                    <small className="form-hint">
                      Google Calendar sends the invitations to these guests.
                    </small>
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
                      {busy ? "Scheduling…" : "Schedule meeting"}{" "}
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
        <div className="toast" role="status" aria-live="polite">
          <Check size={15} />
          {toast}
          <button
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
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
