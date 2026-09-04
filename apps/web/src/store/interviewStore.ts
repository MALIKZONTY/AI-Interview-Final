import { create } from "zustand";

export type QuestionItem = {
  id: string;
  orderIndex: number;
  text: string;
  /** True when the interviewer replaced this planned question to probe the previous answer. */
  isFollowUp?: boolean;
};

type InterviewState = {
  interviewId: string | null;
  questions: QuestionItem[];
  jdText: string;
  numQuestions: number;
  setSession: (payload: {
    interviewId: string;
    questions: QuestionItem[];
    jdText?: string;
    numQuestions?: number;
  }) => void;
  /** Applies an adaptive follow-up the server wrote in place of a planned question. */
  replaceQuestion: (question: QuestionItem) => void;
  clearSession: () => void;
};

export const useInterviewStore = create<InterviewState>((set) => ({
  interviewId: null,
  questions: [],
  jdText: "",
  numQuestions: 5,
  setSession: ({ interviewId, questions, jdText, numQuestions }) =>
    set((s) => ({
      interviewId,
      questions,
      jdText: jdText ?? s.jdText,
      numQuestions: numQuestions ?? s.numQuestions,
    })),
  replaceQuestion: (question) =>
    set((s) => ({
      questions: s.questions.map((q) => (q.id === question.id ? { ...q, ...question } : q)),
    })),
  clearSession: () =>
    set({ interviewId: null, questions: [], jdText: "", numQuestions: 5 }),
}));
