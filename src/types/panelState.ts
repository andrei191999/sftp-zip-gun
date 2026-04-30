import type { UploadMode } from './upload';

export interface PanelState {
  lastFolder?: string;
  lastPresetName?: string;
  mode?: UploadMode;
  anchorFile?: string;
  sectionCollapsed?: { local: boolean };
  groupCollapsed?: Record<number, boolean>;
}
