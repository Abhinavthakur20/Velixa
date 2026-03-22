"use client";

import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastPrimitives.Provider swipeDirection="right">
      {toasts.map((item) => (
        <ToastPrimitives.Root
          key={item.id}
          className={cn(
            "fixed top-4 right-4 z-50 min-w-80 rounded-[1.5rem] border px-4 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl",
            item.variant === "destructive"
              ? "border-[rgba(241,94,108,0.22)] bg-[rgba(38,18,21,0.96)] text-[var(--velixa-ivory)]"
              : "border-[var(--velixa-border)] bg-[rgba(24,24,24,0.96)] text-[var(--velixa-ivory)]",
          )}
        >
          <ToastPrimitives.Title className="font-semibold">{item.title}</ToastPrimitives.Title>
          {item.description ? (
            <ToastPrimitives.Description className="mt-1 text-sm text-[var(--velixa-mist)]">
              {item.description}
            </ToastPrimitives.Description>
          ) : null}
        </ToastPrimitives.Root>
      ))}
      <ToastPrimitives.Viewport className="fixed top-0 right-0 z-50 p-4" />
    </ToastPrimitives.Provider>
  );
}
