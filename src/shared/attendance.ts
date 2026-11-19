// The check-in state machine. The server is the judge; the app uses it only to pick the button.

export type EventType = "CHECK_IN" | "BREAK_START" | "BREAK_END" | "CHECK_OUT";
export type DayState = "NOT_STARTED" | "WORKING" | "ON_BREAK" | "FINISHED";

export type SequenceError =
  | "already_checked_in"
  | "not_checked_in"
  | "already_on_break"
  | "not_on_break"
  | "already_finished";

export const EVENT_TYPES: EventType[] = ["CHECK_IN", "BREAK_START", "BREAK_END", "CHECK_OUT"];

export function transition(
  state: DayState,
  type: EventType,
): { ok: true; next: DayState } | { ok: false; reason: SequenceError } {
  switch (state) {
    case "NOT_STARTED":
      if (type === "CHECK_IN") return { ok: true, next: "WORKING" };
      return { ok: false, reason: "not_checked_in" };
    case "WORKING":
      if (type === "BREAK_START") return { ok: true, next: "ON_BREAK" };
      if (type === "CHECK_OUT") return { ok: true, next: "FINISHED" };
      return { ok: false, reason: type === "CHECK_IN" ? "already_checked_in" : "not_on_break" };
    case "ON_BREAK":
      if (type === "BREAK_END") return { ok: true, next: "WORKING" };
      // Checking out during a break is allowed: the break ends at the check-out time.
      if (type === "CHECK_OUT") return { ok: true, next: "FINISHED" };
      return { ok: false, reason: type === "CHECK_IN" ? "already_checked_in" : "already_on_break" };
    case "FINISHED":
      return { ok: false, reason: "already_finished" };
  }
}

/** State after a day's accepted events, in time order. Invalid steps are skipped. */
export function stateAfter(events: EventType[]): DayState {
  let state: DayState = "NOT_STARTED";
  for (const e of events) {
    const step = transition(state, e);
    if (step.ok) state = step.next;
  }
  return state;
}

/** Buttons to show; the first one is the main action. */
export function nextActions(state: DayState): EventType[] {
  switch (state) {
    case "NOT_STARTED":
      return ["CHECK_IN"];
    case "WORKING":
      return ["BREAK_START", "CHECK_OUT"];
    case "ON_BREAK":
      return ["BREAK_END"];
    case "FINISHED":
      return [];
  }
}
