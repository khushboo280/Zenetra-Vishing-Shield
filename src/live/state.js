// Everything that belongs to the running call. One call at a time.
export const S = { active: false };
export const now = () => performance.now();
