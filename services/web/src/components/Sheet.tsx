import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

interface SheetProps {
  title: string;
  onClose: () => void;
  // Small controls beside the title, e.g. a Profile sheet's Archive and Delete
  // icons. The header wraps, so they can add a full-width line under it.
  actions?: ReactNode;
  // How tall the sheet may grow. "two-thirds" keeps the feed in view around it, but
  // never shrinks below 24rem, so the phone's keyboard cannot squeeze it to a sliver.
  // A sheet that uses it lets one inner part scroll (a min-h-0 flex column down to
  // an overflow-y-auto list) instead of growing past the cap.
  maxHeight?: "full" | "two-thirds";
  children: ReactNode;
}

// Every add and edit opens one of these over the feed (ADR 0008), centered. React
// Aria traps focus inside, closes on Escape and hides the feed from screen readers.
// The overlay takes the visual viewport's height (React Aria sets the variable), so
// when the phone's keyboard opens the sheet re-centers in the space left above it.
// Mount it to open and unmount it to close, so each opening starts from fresh form
// state.
export function Sheet({
  title,
  onClose,
  actions,
  maxHeight = "full",
  children,
}: SheetProps) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      className="fixed top-0 left-0 z-50 flex h-(--visual-viewport-height) w-full items-center justify-center bg-black/40 p-4"
    >
      <Modal
        className={`flex ${maxHeight === "full" ? "max-h-full" : "max-h-[min(100%,max(66.667%,24rem))]"} w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl`}
      >
        <Dialog className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 outline-none">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
            <Heading
              slot="title"
              className="min-w-0 flex-1 truncate text-lg font-semibold"
            >
              {title}
            </Heading>
            {actions}
          </div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
