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
// starts from fresh form state.
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
      <Modal className="max-h-full w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4">
        <Dialog className="flex flex-col gap-4 outline-none">
          <Heading slot="title" className="text-lg font-semibold">
            {title}
          </Heading>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
