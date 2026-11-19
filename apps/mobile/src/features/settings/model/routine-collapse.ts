import { switchPreference } from "./secure-preference";

const preference = switchPreference("openbot.mobile.collapseRoutineRows.v1", true);

export const useRoutineCollapsePreference = preference.store;
export const loadRoutineCollapsePreference = preference.load;
export const saveRoutineCollapsePreference = preference.save;
