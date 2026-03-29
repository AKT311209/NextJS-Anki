import { create } from "zustand";

type CollectionStore = {
  isReady: boolean;
  setReady: (isReady: boolean) => void;
};

export const useCollectionStore = create<CollectionStore>((set) => ({
  isReady: false,
  setReady: (isReady) => set({ isReady }),
}));
