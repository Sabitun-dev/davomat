// Group video notes (spec 5.4). Every round video in the group is stored and linked to the
// worker's nearest event: a video from 15 min before to 5 min after the event (settings).

import { db, isUniqueViolation, transaction, type Tx } from "../lib/db.ts";
import { parseSettings, type CompanySettings } from "../lib/settings.ts";
import { recalcDay } from "../pay/recalc.ts";
import { groupOfCompany } from "../companies/group.ts";
import type { AttendanceEvent } from "../generated/prisma/client.ts";

/** Is a video sent at `videoAt` inside the window of an event at `eventAt`? */
export function inWindow(eventAt: Date, videoAt: Date, beforeMin: number, afterMin: number): boolean {
  const diff = videoAt.getTime() - eventAt.getTime();
  return diff >= -beforeMin * 60_000 && diff <= afterMin * 60_000;
}

/** The candidate closest in time that is inside the window, or null. */
export function nearest<T extends { at: Date }>(
  pivot: Date,
  candidates: T[],
  fits: (candidate: T) => boolean,
): T | null {
  let best: T | null = null;
  for (const c of candidates) {
    if (!fits(c)) continue;
    if (!best || Math.abs(c.at.getTime() - pivot.getTime()) < Math.abs(best.at.getTime() - pivot.getTime())) best = c;
  }
  return best;
}

/** After an event is accepted: link the worker's nearest unlinked video in the window. */
export async function linkVideoToEvent(tx: Tx, event: AttendanceEvent, settings: CompanySettings): Promise<void> {
  if (event.source !== "APP" || event.status !== "ACCEPTED") return;
  // Only videos from the event's own company group count.
  const groupId = await groupOfCompany(event.companyId, tx);
  if (groupId === null) return;
  const user = await tx.user.findUniqueOrThrow({ where: { id: event.userId }, select: { telegramId: true } });
  const from = new Date(event.serverTime.getTime() - settings.videoBeforeMin * 60_000);
  const to = new Date(event.serverTime.getTime() + settings.videoAfterMin * 60_000);
  const videos = await tx.videoNote.findMany({
    where: { chatId: groupId, userTelegramId: user.telegramId, linkedEventId: null, sentAt: { gte: from, lte: to } },
  });
  const pick = nearest(
    event.serverTime,
    videos.map((v) => ({ ...v, at: v.sentAt })),
    (v) => inWindow(event.serverTime, v.at, settings.videoBeforeMin, settings.videoAfterMin),
  );
  if (pick) await tx.videoNote.update({ where: { id: pick.id }, data: { linkedEventId: event.id, userId: event.userId } });
}

/**
 * A round video in a company group. `companyId` is the company that owns the group (see
 * companies/group.ts). The video is linked only to members of THAT company.
 */
export async function onGroupVideoNote(input: {
  companyId: number;
  chatId: bigint;
  messageId: number;
  /** Forum topic of the video, if any. */
  threadId?: number | null;
  fromTelegramId: bigint;
  sentAt: Date;
}): Promise<{ videoId: number; linkedEvent: AttendanceEvent | null } | null> {
  const found = await db().user.findUnique({ where: { telegramId: input.fromTelegramId }, select: { id: true } });
  // A person who is not an active member of this company is stored without a user link.
  const membership = found
    ? await db().membership.findUnique({ where: { userId_companyId: { userId: found.id, companyId: input.companyId } }, include: { company: true } })
    : null;
  const user = membership?.active ? found : null;
  let videoId: number;
  try {
    const v = await db().videoNote.create({
      data: {
        chatId: input.chatId,
        messageId: input.messageId,
        threadId: input.threadId ?? null,
        userTelegramId: input.fromTelegramId,
        userId: user?.id ?? null,
        sentAt: input.sentAt,
      },
    });
    videoId = v.id;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
  if (!user) return { videoId, linkedEvent: null };

  // The other direction: a video that arrives after the event.
  return transaction(async (tx) => {
    const settings = parseSettings(membership!.company.settings);
    const from = new Date(input.sentAt.getTime() - settings.videoAfterMin * 60_000);
    const to = new Date(input.sentAt.getTime() + settings.videoBeforeMin * 60_000);
    const events = await tx.attendanceEvent.findMany({
      where: {
        userId: user.id,
        companyId: input.companyId,
        status: "ACCEPTED",
        source: "APP",
        voided: false,
        videoNote: null,
        serverTime: { gte: from, lte: to },
      },
    });
    const pick = nearest(
      input.sentAt,
      events.map((e) => ({ ...e, at: e.serverTime })),
      (e) => inWindow(e.at, input.sentAt, settings.videoBeforeMin, settings.videoAfterMin),
    );
    if (pick) {
      await tx.videoNote.update({ where: { id: videoId }, data: { linkedEventId: pick.id } });
      await recalcDay(tx, user.id, pick.localDate);
      const { at: _at, ...event } = pick;
      return { videoId, linkedEvent: event as AttendanceEvent };
    }
    return { videoId, linkedEvent: null };
  });
}

/** https://t.me/c/<id>/<message> for a supergroup (-100… ids); in a forum topic t.me/c/<id>/<topic>/<message>. */
export function videoLink(chatId: bigint, messageId: number, threadId?: number | null): string | null {
  const s = chatId.toString();
  if (!s.startsWith("-100")) return null;
  return threadId ? `https://t.me/c/${s.slice(4)}/${threadId}/${messageId}` : `https://t.me/c/${s.slice(4)}/${messageId}`;
}
