export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function showLocalNotification(title: string, body: string, icon = "/icon-192.png") {
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon });
  }
}
