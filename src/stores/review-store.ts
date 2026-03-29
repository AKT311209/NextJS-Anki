import { create } from "zustand";

type ReviewStore = {
    answered: number;
    increment: () => void;
};

export const useReviewStore = create<ReviewStore>((set) => ({
    answered: 0,
    increment: () => set((state) => ({ answered: state.answered + 1 })),
}));
