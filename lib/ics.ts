export type IcsEvent = {
  id: string;
  title: string;
  description?: string | null;
  place?: string | null;
  starts_at?: string | null;
};

function icsDate(date: string): string {
  return new Date(date).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcs(events: IcsEvent[], calName: string): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CasePortal//RU",
    `X-WR-CALNAME:${escapeText(calName)}`,
    "CALSCALE:GREGORIAN",
  ];
  const now = icsDate(new Date().toISOString());
  for (const e of events) {
    if (!e.starts_at) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@caseportal`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(e.starts_at)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `LOCATION:${escapeText(e.place ?? "")}`,
      `DESCRIPTION:${escapeText((e.description ?? "").slice(0, 300))}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(events: IcsEvent[], calName: string, filename: string) {
  const blob = new Blob([buildIcs(events, calName)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
