import { z } from "zod";


//






//





export const REALTIME_EVENTS = {

  activityCreated: "activity_created",
  /** A question about an activity is sent to the author and the questioner. */
  questionAsked: "question_asked",

  answerReceived: "answer_received",

  conversationClosed: "conversation_closed",

  activityCancelled: "activity_cancelled",

  approvalPending: "approval_pending",

  approvalDecided: "approval_decided",

  reconnected: "reconnected",
} as const;

export type RealtimeEventKind =
  (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];


export const realtimeNotifySchema = z.object({
  kind: z.enum([
    REALTIME_EVENTS.activityCreated,
    REALTIME_EVENTS.questionAsked,
    REALTIME_EVENTS.answerReceived,
    REALTIME_EVENTS.conversationClosed,
    REALTIME_EVENTS.activityCancelled,
    REALTIME_EVENTS.approvalPending,
    REALTIME_EVENTS.approvalDecided,
  ]),

  userIds: z.array(z.string().uuid()).min(1),
});

export type RealtimeNotify = z.infer<typeof realtimeNotifySchema>;


export type PublishableEventKind = RealtimeNotify["kind"];


export interface RealtimeEvent {
  kind: RealtimeEventKind;
}


export const REALTIME_CHANNEL = "acta_events";
