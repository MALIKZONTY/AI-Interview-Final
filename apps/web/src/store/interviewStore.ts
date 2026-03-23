import { create } from "zustand";

export type QuestionItem = { id: string; orderIndex: number; text: string };

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
  clearSession: () =>
    set({ interviewId: null, questions: [], jdText: "", numQuestions: 5 }),
}));
