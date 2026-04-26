function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function shouldShowOnDashboard(vehicle, now = new Date()) {
  if (!vehicle || vehicle.is_archived) {
    return false;
  }

  if (vehicle.status !== "ready") {
    return true;
  }

  const dueDate = new Date(vehicle.due_date);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  return startOfDay(now).getTime() <= startOfDay(dueDate).getTime();
}
