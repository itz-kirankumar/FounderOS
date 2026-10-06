import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { tomorrowAtSixInTimezone } from "./timezone";

export type Item = { id: string; [key: string]: any };
export const listen = (
  teamId: string,
  name: string,
  callback: (items: Item[]) => void,
) =>
  onSnapshot(
    query(collection(db, "teams", teamId, name), orderBy("createdAt", "desc")),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
export async function addItem(
  teamId: string,
  name: string,
  data: Record<string, any>,
  actor: string,
) {
  const batch = writeBatch(db);
  const created = doc(collection(db, "teams", teamId, name));
  batch.set(created, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: actor,
  });
  batch.set(doc(collection(db, "teams", teamId, "activity")), {
    type: `${name.slice(0, -1)}_created`,
    title: data.title || data.description || `New ${name.slice(0, -1)}`,
    actor,
    entityId: created.id,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return created.id;
}
export async function changeTask(
  teamId: string,
  id: string,
  patch: Record<string, any>,
  actor: string,
) {
  const { previousStatus, ...changes } = patch;
  const batch = writeBatch(db);
  batch.update(doc(db, "teams", teamId, "tasks", id), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, "teams", teamId, "activity")), {
    type: "task_updated",
    title:
      changes.status === "Completed" ? "Completed a task" : "Updated a task",
    detail: changes.title
      ? `${changes.title}${changes.status ? ` · ${previousStatus || "New"} → ${changes.status}` : ""}`
      : "Task status or details changed",
    actor,
    entityId: id,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}
export async function ensureWorkspace(
  uid: string,
  profile: {
    displayName: string;
    email: string;
    photoURL?: string | null;
    timezone: string;
  },
) {
  const profileRef = doc(db, "users", uid);
  const existingProfile = (await getDoc(profileRef)).data() || {};
  const timezone = existingProfile.timezone || profile.timezone;
  await setDoc(
    profileRef,
    {
      ...profile,
      timezone,
      timezoneSource: existingProfile.timezoneSource || "detected",
      timezoneConfirmed: existingProfile.timezoneConfirmed === true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  const proposedTeamRef = doc(collection(db, "teams"));
  const reservation = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(profileRef);
    const existingId = snapshot.data()?.teamId as string | undefined;
    if (existingId) return { teamId: existingId, isNew: false };
    transaction.set(
      profileRef,
      { teamId: proposedTeamRef.id, updatedAt: serverTimestamp() },
      { merge: true },
    );
    return { teamId: proposedTeamRef.id, isNew: true };
  });
  const teamRef = doc(db, "teams", reservation.teamId);
  const name = profile.displayName || profile.email.split("@")[0] || "Founder";
  if (reservation.isNew) {
    await setDoc(teamRef, {
      name: `${name}'s workspace`,
      ownerUid: uid,
      createdAt: serverTimestamp(),
      timezone,
    });
    await setDoc(doc(db, "teams", teamRef.id, "members", uid), {
      uid,
      displayName: name,
      email: profile.email,
      role: "Owner",
      timezone,
      joinedAt: serverTimestamp(),
    });
    const starterBatch = writeBatch(db);
    starterBatch.set(
      doc(db, "teams", teamRef.id, "projects", "starter-project"),
      {
        title: "Product launch",
        status: "Active",
        description: "Your first shared project",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
      },
    );
    const firstDue = tomorrowAtSixInTimezone(timezone);
    starterBatch.set(
      doc(db, "teams", teamRef.id, "tasks", "starter-priorities"),
      {
        title: "Set the week’s top three priorities",
        status: "Planned",
        priority: "High",
        ownerUid: uid,
        dueAt: firstDue,
        timezone,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
      },
    );
    await starterBatch.commit();
  } else {
    let workspaceReady = false;
    const membershipRef = doc(db, "teams", teamRef.id, "members", uid);
    for (let attempt = 0; attempt < 20 && !workspaceReady; attempt += 1) {
      try {
        workspaceReady = (await getDoc(membershipRef)).exists();
      } catch {
        // A concurrent first sign-in may still be creating this membership.
      }
      if (!workspaceReady) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!workspaceReady) {
      throw new Error("Workspace setup is still completing. Please try again.");
    }
  }
  return teamRef.id;
}
