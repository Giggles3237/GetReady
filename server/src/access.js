export function isAdmin(user) {
  return user?.role === "admin";
}

export function hasManagerAccess(user) {
  return ["admin", "manager"].includes(user?.role);
}
