
// Follow-up and answer timing rules (audit finding 6, P3-1, and P3-2,
// 23.08.2026).
//




//








//




export interface ItemView {
  openedAt: Date;

  events: { kind: string; createdAt: Date }[];
}


export function itemClosure(item: ItemView): Date | null {
  let closure: Date | null = null;

  for (const event of item.events) {
    if (event.kind === "CLOSED") closure = event.createdAt;
    if (event.kind === "REOPENED") closure = null;
  }

  return closure;
}

export interface ConversationView {
  askerId: string;

  respondentId: string;
  openedAt: Date;

  closure: Date | null;

  messages: { authorId: string; createdAt: Date }[];
}


export type ResponsibilityEnd = "ANSWERED" | "CLOSED" | "PERIOD_END";


export interface AnswerResponsibility {
  startedAt: Date;
  endedAt: Date;
  end: ResponsibilityEnd;
}


export function answerResponsibilities(
  conversation: ConversationView,
  personId: string,
  measurementInstant: Date,
): AnswerResponsibility[] {
  const participants = [conversation.askerId, conversation.respondentId];
  if (!participants.includes(personId)) return [];

  const otherPersonId =
    personId === conversation.askerId ? conversation.respondentId : conversation.askerId;

  const lastAt =
    conversation.closure && conversation.closure < measurementInstant
      ? conversation.closure
      : measurementInstant;

  const responsibilities: AnswerResponsibility[] = [];
  let roundStart: Date | null = null;

  for (const message of conversation.messages) {
    if (message.authorId === personId) {
      if (roundStart) {
        responsibilities.push({
          startedAt: roundStart,
          endedAt: message.createdAt,
          end: "ANSWERED",
        });
        roundStart = null;
      }
      continue;
    }

    if (message.authorId === otherPersonId) {
      roundStart = message.createdAt;
    }
  }

  if (roundStart) {
    const closed =
      conversation.closure !== null && conversation.closure < measurementInstant;
    responsibilities.push({
      startedAt: roundStart,
      endedAt: lastAt,
      end: closed ? "CLOSED" : "PERIOD_END",
    });
  }

  return responsibilities;
}


export function isInPeriod(
  responsibility: AnswerResponsibility,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  return responsibility.startedAt < periodEnd && responsibility.endedAt > periodStart;
}


export function itemLastMovement(item: ItemView): Date {
  return item.events.reduce(
    (last, event) => (event.createdAt > last ? event.createdAt : last),
    item.openedAt,
  );
}
