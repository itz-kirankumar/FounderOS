import { GoogleAuthProvider, reauthenticateWithPopup } from "firebase/auth";
import { auth } from "./firebase";

export async function requestGoogleCalendarAccess() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/calendar.events");
  provider.setCustomParameters({ prompt: "consent" });
  if (!auth.currentUser) {
    throw new Error("Sign in before connecting Google Calendar.");
  }
  const result = await reauthenticateWithPopup(auth.currentUser, provider);
  const accessToken =
    GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!accessToken) {
    throw new Error(
      "Google did not grant Calendar access. Try connecting again.",
    );
  }
  return accessToken;
}

export async function scheduleGoogleMeeting(
  input: {
    title: string;
    description: string;
    start: Date;
    end: Date;
    timezone: string;
    attendeeEmails: string[];
  },
  accessToken?: string,
) {
  const calendarToken = accessToken || (await requestGoogleCalendarAccess());

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${calendarToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: {
          dateTime: input.start.toISOString(),
          timeZone: input.timezone,
        },
        end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
        attendees: input.attendeeEmails.map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    },
  );
  const resultBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = resultBody?.error?.message;
    throw new Error(
      typeof message === "string"
        ? message
        : "Google Calendar could not create this meeting. Check Calendar API setup and permissions.",
    );
  }

  let event = resultBody;
  const getMeetUrl = (calendarEvent: typeof resultBody) =>
    calendarEvent.hangoutLink ||
    calendarEvent.conferenceData?.entryPoints?.find(
      (entry: { entryPointType?: string; uri?: string }) =>
        entry.entryPointType === "video" && entry.uri,
    )?.uri;
  for (let attempt = 0; attempt < 3 && !getMeetUrl(event); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const refresh = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event.id)}?conferenceDataVersion=1`,
      { headers: { Authorization: `Bearer ${calendarToken}` } },
    );
    if (refresh.ok) event = await refresh.json();
  }
  const meetUrl = getMeetUrl(event) || "";
  return {
    eventId: event.id as string,
    meetUrl: (meetUrl || "") as string,
    htmlLink: event.htmlLink as string,
  };
}

export async function updateGoogleMeeting(
  eventId: string,
  input: {
    title: string;
    description: string;
    start: Date;
    end: Date;
    timezone: string;
    attendeeEmails?: string[];
  },
  accessToken: string,
) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: {
          dateTime: input.start.toISOString(),
          timeZone: input.timezone,
        },
        end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
        ...(input.attendeeEmails?.length
          ? { attendees: input.attendeeEmails.map((email) => ({ email })) }
          : {}),
      }),
    },
  );
  const event = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof event?.error?.message === "string"
        ? event.error.message
        : "Google Calendar could not update this meeting.",
    );
  }
  let current = event;
  const getMeetUrl = (calendarEvent: typeof event) =>
    calendarEvent.hangoutLink ||
    calendarEvent.conferenceData?.entryPoints?.find(
      (entry: { entryPointType?: string; uri?: string }) =>
        entry.entryPointType === "video" && entry.uri,
    )?.uri;
  if (!getMeetUrl(current)) {
    const refreshed = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (refreshed.ok) current = await refreshed.json();
  }
  return {
    eventId: eventId,
    meetUrl: (getMeetUrl(current) || "") as string,
    htmlLink: current.htmlLink as string,
  };
}

export async function getGoogleMeeting(eventId: string, accessToken: string) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const event = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof event?.error?.message === "string"
        ? event.error.message
        : "Google Calendar could not load this meeting.",
    );
  }
  const meetUrl =
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.find(
      (entry: { entryPointType?: string; uri?: string }) =>
        entry.entryPointType === "video" && entry.uri,
    )?.uri ||
    "";
  return {
    eventId,
    meetUrl: meetUrl as string,
    htmlLink: event.htmlLink as string,
  };
}

export async function findGoogleMeeting(
  input: {
    title: string;
    description: string;
    start: Date;
    end: Date;
  },
  accessToken: string,
) {
  const params = new URLSearchParams({
    timeMin: new Date(input.start.getTime() - 60_000).toISOString(),
    timeMax: new Date(input.end.getTime() + 60_000).toISOString(),
    q: "FounderOS",
    singleEvents: "true",
    orderBy: "startTime",
    conferenceDataVersion: "1",
  });
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof result?.error?.message === "string"
        ? result.error.message
        : "Google Calendar could not look for an existing meeting.",
    );
  }
  const startTime = input.start.getTime();
  const candidates = (result.items || []).filter(
    (event: {
      id?: string;
      summary?: string;
      description?: string;
      start?: { dateTime?: string };
    }) =>
      event.id &&
      event.summary === input.title &&
      event.description === input.description &&
      event.start?.dateTime &&
      Math.abs(new Date(event.start.dateTime).getTime() - startTime) <= 60_000,
  );
  if (candidates.length > 1) {
    throw new Error(
      "More than one matching Google Calendar event exists. Remove the duplicate events in Google Calendar, then retry.",
    );
  }
  if (!candidates.length) return null;
  return getGoogleMeeting(candidates[0].id as string, accessToken);
}

export async function deleteGoogleMeeting(
  eventId: string,
  accessToken: string,
) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      typeof result?.error?.message === "string"
        ? result.error.message
        : "Google Calendar could not remove this meeting.",
    );
  }
}
