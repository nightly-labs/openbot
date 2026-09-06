import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AccountSession, AvatarImageInput, CentralAuthUser } from "@openbot/contracts/ipc";
import { normalizeAccountName, validateProfileName } from "@openbot/contracts/validation";
import { createEffect, createMemo, createStore } from "solid-js";
import { normalizeAvatarFile } from "../../../avatar-image";

interface ProfileStoreProps {
  open: boolean;
  account: CentralAuthUser;
  onUpdateAccountName: (name: string) => Promise<void>;
  onUpdateAccountAvatar: (image: AvatarImageInput | null) => Promise<void>;
  onListAccountSessions?: () => Promise<AccountSession[]>;
  onRevokeAccountSession?: (sessionId: string) => Promise<void>;
  processAvatarFile?: (file: File) => Promise<AvatarImageInput>;
}

interface ProfileNameEdit {
  busy: boolean;
  name: string;
  saveError: string | null;
  savedName: string;
  touched: boolean;
}

interface AvatarUpload {
  busy: boolean;
  error: string | null;
}

/**
 * One record per panel of the Profile tab. Each group's fields are written together — a save
 * touches the draft, its error and its busy flag at once — so they are one store rather than a
 * signal each, and replacing one field re-renders only what read that field.
 */
interface SettingsProfilePanels {
  avatar: AvatarUpload;
  profile: ProfileNameEdit;
  sessions: { items: AccountSession[]; loading: boolean; error: string | null; revokingId: string | null };
}

/**
 * The Profile tab: the display-name draft, the avatar upload and the account session list.
 *
 * Created by `SettingsModal` rather than by the tab, because the dialog's footer save bar reads
 * `nameDirty()` and has to keep working while another tab is selected.
 */
export function createSettingsProfileStore(props: ProfileStoreProps, isActive: () => boolean) {
  const [panels, setPanels] = createStore<SettingsProfilePanels>({
    avatar: { busy: false, error: null },
    profile: { busy: false, name: "", saveError: null, savedName: "", touched: false },
    sessions: { items: [], loading: false, error: null, revokingId: null },
  });
  let avatarFileInput: HTMLInputElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  let sessionsRevision = 0;

  const accountName = () => props.account.name?.trim() || props.account.email.split("@")[0] || props.account.email;

  async function refreshSessions() {
    if (!props.onListAccountSessions) return;
    const revision = ++sessionsRevision;
    setPanels((state) => {
      state.sessions.loading = true;
      state.sessions.error = null;
    });
    try {
      const items = await props.onListAccountSessions();
      if (revision !== sessionsRevision) return;
      setPanels((state) => {
        state.sessions.items = items;
      });
    } catch {
      if (revision !== sessionsRevision) return;
      setPanels((state) => {
        state.sessions.error = "Could not load account sessions. Please try again.";
      });
    } finally {
      if (revision === sessionsRevision)
        setPanels((state) => {
          state.sessions.loading = false;
        });
    }
  }

  async function revokeSession(sessionId: string) {
    if (!props.onRevokeAccountSession || panels.sessions.revokingId) return;
    const revision = sessionsRevision;
    setPanels((state) => {
      state.sessions.revokingId = sessionId;
      state.sessions.error = null;
    });
    try {
      await props.onRevokeAccountSession(sessionId);
      if (revision !== sessionsRevision) return;
      await refreshSessions();
    } catch {
      if (revision !== sessionsRevision) return;
      setPanels((state) => {
        state.sessions.error = "Could not disconnect this session. Please try again.";
      });
    } finally {
      setPanels((state) => {
        if (state.sessions.revokingId === sessionId) state.sessions.revokingId = null;
      });
    }
  }

  createEffect(
    () => ({ open: props.open, active: isActive(), accountId: props.account.id, list: props.onListAccountSessions }),
    ({ open, active, list }) => {
      sessionsRevision += 1;
      setPanels((state) => {
        state.sessions.items = [];
        state.sessions.revokingId = null;
      });
      if (open && active && list) void refreshSessions();
      return () => {
        sessionsRevision += 1;
      };
    },
  );

  createEffect(
    () => props.account.name,
    () => {
      const name = accountName();
      setPanels((state) => {
        state.profile.savedName = normalizeAccountName(name);
        state.profile.name = name;
        state.profile.touched = false;
        state.profile.saveError = null;
      });
    },
  );

  const nameValidation = createMemo(() => validateProfileName(panels.profile.name));
  const normalizedName = () => nameValidation().name;
  const nameError = () => {
    switch (nameValidation().error) {
      case "unsafe":
        return "Remove line breaks and hidden or control characters.";
      case "required":
        return "Enter a display name.";
      case "too-short":
        return `Use at least ${INPUT_LIMITS.profileNameMin} characters.`;
      case "too-long":
        return `Use no more than ${INPUT_LIMITS.profileName} characters.`;
      case null:
        return null;
    }
  };
  const visibleNameError = () => panels.profile.saveError ?? (panels.profile.touched ? nameError() : null);
  const nameDirty = () => normalizedName() !== panels.profile.savedName;

  async function updateAvatar(image: AvatarImageInput | null): Promise<void> {
    if (panels.avatar.busy) return;
    setPanels((state) => {
      state.avatar.busy = true;
      state.avatar.error = null;
    });
    try {
      await props.onUpdateAccountAvatar(image);
    } catch (error) {
      setPanels((state) => {
        state.avatar.error = error instanceof Error ? error.message : "Could not update your profile photo.";
      });
    } finally {
      setPanels((state) => {
        state.avatar.busy = false;
      });
    }
  }

  function updateName(value: string): void {
    setPanels((state) => {
      state.profile.name = value;
      state.profile.saveError = null;
      if (!validateProfileName(value).error) state.profile.touched = false;
    });
  }

  /** The blur handler: a draft the user never changed must not start showing errors. */
  function markTouchedIfDirty(): void {
    if (!nameDirty()) return;
    setPanels((state) => {
      state.profile.touched = true;
    });
  }

  function resetName(): void {
    setPanels((state) => {
      state.profile.name = state.profile.savedName;
      state.profile.touched = false;
      state.profile.saveError = null;
    });
  }

  async function saveName(): Promise<void> {
    if (panels.profile.busy) return;
    setPanels((state) => {
      state.profile.touched = true;
      state.profile.saveError = null;
    });
    if (nameError()) {
      queueMicrotask(() => nameInput?.focus({ preventScroll: true }));
      return;
    }
    if (!nameDirty()) return;
    const name = normalizedName();
    setPanels((state) => {
      state.profile.busy = true;
    });
    try {
      await props.onUpdateAccountName(name);
      setPanels((state) => {
        state.profile.savedName = name;
        state.profile.name = name;
        state.profile.touched = false;
      });
    } catch (error) {
      setPanels((state) => {
        state.profile.saveError = error instanceof Error ? error.message : "Could not update your display name.";
      });
      queueMicrotask(() => nameInput?.focus({ preventScroll: true }));
    } finally {
      setPanels((state) => {
        state.profile.busy = false;
      });
    }
  }

  async function uploadAvatar(file: File | undefined): Promise<void> {
    if (!file || panels.avatar.busy) return;
    setPanels((state) => {
      state.avatar.busy = true;
      state.avatar.error = null;
    });
    try {
      const image = await (props.processAvatarFile ?? normalizeAvatarFile)(file);
      await props.onUpdateAccountAvatar(image);
    } catch (error) {
      setPanels((state) => {
        state.avatar.error = error instanceof Error ? error.message : "Could not process your profile photo.";
      });
    } finally {
      setPanels((state) => {
        state.avatar.busy = false;
      });
      if (avatarFileInput) avatarFileInput.value = "";
    }
  }

  function registerAvatarInput(element: HTMLInputElement): void {
    avatarFileInput = element;
  }

  function registerNameInput(element: HTMLInputElement): void {
    nameInput = element;
  }

  function openAvatarPicker(): void {
    avatarFileInput?.click();
  }

  return {
    markTouchedIfDirty,
    nameDirty,
    openAvatarPicker,
    refreshSessions,
    registerAvatarInput,
    registerNameInput,
    resetName,
    revokeSession,
    saveName,
    state: panels,
    updateAvatar,
    updateName,
    uploadAvatar,
    visibleNameError,
  };
}

export type SettingsProfileStore = ReturnType<typeof createSettingsProfileStore>;
