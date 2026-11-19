// Group video notes (spec section 5.4). Every round video in the group is stored.

import { db, isUniqueViolation } from "../lib/db.ts";

export async function onGroupVideoNote(input: {
  chatId: bigint;
  messageId: number;
  fromTelegramId: bigint;
  sentAt: Date;
}): Promise<void> {
  const user = await db().user.findUnique({ where: { telegramId: input.fromTelegramId }, select: { id: true } });
  try {
    await db().videoNote.create({
      data: {
        chatId: input.chatId,
        messageId: input.messageId,
        userTelegramId: input.fromTelegramId,
        userId: user?.id ?? null,
        sentAt: input.sentAt,
      },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}
