// Simple toast hook
import { useState, useCallback } from "react";

interface ToastProps {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  const toast = useCallback((props: ToastProps) => {
    // For now, just use console.log and window.alert for notifications
    console.log(`[Toast] ${props.title}: ${props.description || ""}`);
    
    // Optional: You can implement a more sophisticated toast system later
    if (props.variant === "destructive") {
      console.error(props.description);
    }
    
    setToasts((prev) => [...prev, props]);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 3000);
  }, []);

  return { toast, toasts };
}

