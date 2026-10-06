import { GoogleAuthProvider, reauthenticateWithPopup } from "firebase/auth";
import { auth } from "./firebase";

export async function scheduleGoogleMeeting(input: {
  title: string;
  description: string;
  start: Date;
  end: Date;
  timezone: string;
  attendeeEmails: string[];
}) {
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

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
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
      { headers: { Authorization: `Bearer ${accessToken}` } },
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
