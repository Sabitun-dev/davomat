// Database client. On Netlify it talks to Neon through the serverless driver (WebSocket),
// which supports transactions. Tests replace it with an in-memory Postgres (see tests/helpers).

import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { PrismaClient, Prisma } from "../generated/prisma/client.ts";
import { env } from "./env.ts";

export { Prisma };
export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

let client: PrismaClient | undefined;

export function db(): PrismaClient {
  if (!client) {
    if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;
    const adapter = new PrismaNeon({ connectionString: env.databaseUrl });
    client = new PrismaClient({ adapter });
  }
  return client;
}

/** Used by tests to plug in another database. */
export function setDb(c: PrismaClient): void {
  client = c;
}

/** Runs work in one database transaction. */
export function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db().$transaction(work, { maxWait: 10000, timeout: 20000 });
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
