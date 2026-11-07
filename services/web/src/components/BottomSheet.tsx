import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

interface BottomSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

// Every add and edit opens one of these over the feed (ADR 0008). React Aria traps
// focus inside, closes on Escape and hides the feed from screen readers. The overlay
// takes the visual viewport's height, so the phone's keyboard pushes the sheet up
// instead of covering it. Mount it to open and unmount it to close, so each opening
// starts from fresh form state. iOS can still show a strip of page between the sheet
// and the keyboard, so the sheet's white runs a full screen past its bottom edge.
export function BottomSheet({ title, onClose, children }: BottomSheetProps) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      className="fixed top-0 left-0 z-50 flex h-(--visual-viewport-height) w-full items-end justify-center bg-black/40"
    >
      <Modal className="relative flex max-h-full w-full max-w-md flex-col rounded-t-2xl bg-white after:absolute after:inset-x-0 after:top-full after:h-screen after:bg-white">
        <Dialog className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 outline-none">
          <Heading slot="title" className="text-lg font-semibold">
            {title}
          </Heading>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
