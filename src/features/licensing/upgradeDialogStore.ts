import { create } from 'zustand';
import type { ProFeature } from '../../proto/licensing';

interface UpgradeDialogState {
  open: boolean;
  /// The feature that triggered the upgrade prompt, if any. Used to
  /// customize the dialog copy.
  triggerFeature: ProFeature | null;
  /// Open the dialog. Pass a feature to highlight why the user is being
  /// asked to upgrade.
  openDialog: (feature?: ProFeature | null) => void;
  /// Close the dialog.
  closeDialog: () => void;
}

export const useUpgradeDialogStore = create<UpgradeDialogState>((set) => ({
  open: false,
  triggerFeature: null,
  openDialog: (feature = null) => set({ open: true, triggerFeature: feature }),
  closeDialog: () => set({ open: false, triggerFeature: null }),
}));

/// Convenience hook used by FeatureGate. Alias for `openDialog`.
export const openUpgrade = (feature?: ProFeature | null) =>
  useUpgradeDialogStore.getState().openDialog(feature);
