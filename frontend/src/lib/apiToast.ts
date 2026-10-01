import { toast } from "sonner";

import { getUserFacingErrorMessage } from "@/lib/apiError";

export function showApiErrorToast(
  title: string,
  error: unknown,
  fallback: string,
) {
  toast.error(title, {
    description: getUserFacingErrorMessage(error, fallback),
  });
}
