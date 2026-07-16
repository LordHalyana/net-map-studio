import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  /** Destructive confirms get the danger button treatment. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirmation dialog (ui-polish M2) for actions that need a deliberate yes. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      role="alertdialog"
      data-testid="confirm-dialog"
      footer={
        <>
          <Button data-testid="confirm-dialog-cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            data-testid="confirm-dialog-confirm"
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}
