import { Info } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function OpsecWarningDialog({
  open,
  onOpenChange,
  onAcknowledge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledge: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Info className="size-5 text-blue-400" />
            Remote Repository Notice
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            Configuring a remote URL means this vault's content may be pushed to
            an external server. Make sure the remote is private and does not
            expose sensitive pentest data, client findings, or credentials.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onAcknowledge();
            }}
          >
            I understand
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
