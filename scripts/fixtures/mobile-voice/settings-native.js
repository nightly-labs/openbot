export const entries = new Map();
export const getItemAsync = async (key) => entries.get(key) ?? null;
export const setItemAsync = async (key, value) => {
  entries.set(key, value);
};
export const deleteItemAsync = async (key) => {
  entries.delete(key);
};
