"use client";

import * as React from "react";

type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
};

const TOAST_LIMIT = 5;
const listeners = new Set<(toasts: Toast[]) => void>();
let memoryState: Toast[] = [];

function emit() {
  for (const listener of listeners) {
    listener(memoryState);
  }
}

export function toast(input: Omit<Toast, "id">) {
  const id = crypto.randomUUID();
  memoryState = [{ id, ...input }, ...memoryState].slice(0, TOAST_LIMIT);
  emit();
  setTimeout(() => {
    memoryState = memoryState.filter((toastItem) => toastItem.id !== id);
    emit();
  }, 4000);
}

export function useToast() {
  const [toasts, setToasts] = React.useState<Toast[]>(memoryState);

  React.useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  return { toasts, toast };
}
